import type { FastifyInstance } from 'fastify';
import { query } from './db.js';
import { loadAiConfig } from './ai.js';
import { analyzeMeeting, assessMeeting, type TranscriptSegment } from './meeting-analysis.js';
import { rastrearIa } from './langfuse.js';

type AudioJob = { id: string; tenant_id: string; meeting_id: string; audio: Buffer; mime_type: string };
type AnalysisJob = { id: string; tenant_id: string; created_by: string | null; capture_incomplete: boolean };
let preferAnalysis = false;

export async function transcribeMeetingAudio(audio: Buffer, mime: string, signal?: AbortSignal): Promise<string> {
  const base = process.env.MEETING_STT_URL;
  const key = process.env.MEETING_STT_KEY;
  if (!base || !key) throw new Error('Transcrição local indisponível. Verifique o serviço e tente novamente.');
  const response = await fetch(`${base.replace(/\/$/, '')}/transcribe`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(180000), ...(signal ? [signal] : [])]),
    headers: { 'Content-Type': mime, Authorization: `Bearer ${key}` }, body: new Uint8Array(audio),
  });
  if (!response.ok) throw new Error('Transcrição local indisponível. Verifique o serviço e tente novamente.');
  const result = await response.json() as { text?: unknown };
  if (typeof result.text !== 'string' || result.text.length > 12000) throw new Error('A transcrição devolveu uma resposta inválida.');
  return result.text.trim();
}

/** A single lease is claimed atomically; database rows survive browser/server restarts. */
export async function processMeetingQueue(decrypt: (value: string | null) => string | null, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  await query("update meeting_audio_chunks set status='queued' where status='processing' and processing_at < now()-interval '5 minutes'");
  await query("update lead_meetings set analysis_status='queued' where analysis_status='processing' and analysis_started_at < now()-interval '15 minutes'");
  // Failed audio is retained for a bounded retry window, never indefinitely.
  await query("update meeting_audio_chunks set audio=null,error='O áudio temporário expirou. A transcrição deste trecho ficou incompleta.' where status='failed' and audio is not null and created_at < now()-interval '24 hours'");
  const claimAnalysis = async () => (await query<AnalysisJob>(`update lead_meetings set analysis_status='processing',analysis_started_at=now(),analysis_error=null
    where id=(select m.id from lead_meetings m where m.status='ended' and m.analysis_status='queued'
      and not exists(select 1 from meeting_audio_chunks a where a.meeting_id=m.id and a.tenant_id=m.tenant_id and a.status in ('queued','processing'))
      order by m.ended_at for update skip locked limit 1) returning id,tenant_id,created_by,capture_incomplete`)).rows[0];
  let meeting = preferAnalysis ? await claimAnalysis() : undefined;
  const audio = meeting ? undefined : (await query<AudioJob>(`update meeting_audio_chunks set status='processing',processing_at=now()
    where id=(select id from meeting_audio_chunks where status='queued' order by created_at for update skip locked limit 1)
    returning id,tenant_id,meeting_id,audio,mime_type`)).rows[0];
  if (audio) {
    preferAnalysis = true;
    try {
      const text = await transcribeMeetingAudio(audio.audio, audio.mime_type, signal);
      await query("update meeting_audio_chunks set status='done',text=$3,audio=null,error=null where tenant_id=$1 and id=$2", [audio.tenant_id, audio.id, text]);
    } catch {
      await query("update meeting_audio_chunks set status=$3,error=$4 where tenant_id=$1 and id=$2", [audio.tenant_id, audio.id, signal?.aborted ? 'queued' : 'failed', signal?.aborted ? null : 'Não foi possível transcrever este trecho. Verifique o serviço e tente novamente.']);
    }
    return true;
  }
  meeting ??= await claimAnalysis();
  if (!meeting) return false;
  preferAnalysis = false;
  const started = Date.now();
  let model: string | null = null;
  try {
    const segments = (await query<TranscriptSegment & { status: string }>('select id,speaker,text,start_ms,status from meeting_audio_chunks where tenant_id=$1 and meeting_id=$2 order by start_ms,created_at', [meeting.tenant_id, meeting.id])).rows;
    const transcript = segments.filter(s => s.status === 'done' && s.text?.trim());
    const incomplete = meeting.capture_incomplete || segments.some(s => s.status === 'failed');
    let assessment;
    if (!transcript.length) assessment = assessMeeting([], [], incomplete);
    else {
      const config = await loadAiConfig(meeting.tenant_id, decrypt);
      if (!config) throw new Error('Configure o agente de IA da empresa e tente novamente.');
      if (config.provider === 'qwen' && process.env.MEETING_AI_MODEL?.trim()) config.model = process.env.MEETING_AI_MODEL.trim();
      model = config.model;
      assessment = await rastrearIa('geracao', config.model, () => analyzeMeeting(transcript, config, incomplete, {
        signal: AbortSignal.any([AbortSignal.timeout(720000), ...(signal ? [signal] : [])]),
      }), () => ({ ok: true }));
    }
    await query("update lead_meetings set analysis_status='complete',assessment=$3::jsonb,model=$4,analysis_error=null,updated_at=now() where tenant_id=$1 and id=$2", [meeting.tenant_id, meeting.id, JSON.stringify(assessment), model]);
    await query("insert into ai_runs(tenant_id,user_id,job,model,status,duration_ms) values($1,$2,'meeting_assessment',$3,'ok',$4)", [meeting.tenant_id, meeting.created_by, model ?? 'no-transcript', Date.now() - started]);
    await query("insert into events(tenant_id,actor_user_id,entity_type,entity_id,event_type,payload) select tenant_id,created_by,'lead',lead_id,'meeting.assessed',jsonb_build_object('meeting_id',id,'verdict',$3::text) from lead_meetings where tenant_id=$1 and id=$2", [meeting.tenant_id, meeting.id, assessment.verdict]);
  } catch {
    await query("update lead_meetings set analysis_status=$3,analysis_error=$4,updated_at=now() where tenant_id=$1 and id=$2", [meeting.tenant_id, meeting.id, signal?.aborted ? 'queued' : 'failed', signal?.aborted ? null : 'Não foi possível concluir a avaliação. Confira o agente de IA e tente novamente.']);
  }
  return true;
}

export function startMeetingWorker(app: FastifyInstance, decrypt: (value: string | null) => string | null) {
  const controller = new AbortController();
  let pending: Promise<unknown> | null = null;
  const tick = () => {
    if (pending || controller.signal.aborted) return;
    pending = processMeetingQueue(decrypt, controller.signal).catch(() => {
      if (!controller.signal.aborted) app.log.warn('Fila de reuniões indisponível; nova tentativa em breve.');
    }).finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  app.addHook('onReady', async () => { tick(); });
  app.addHook('onClose', async () => { clearInterval(timer); controller.abort(); await pending; });
}
