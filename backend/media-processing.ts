import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { query, transaction } from "./db.js";
import { createMediaStorage } from "./media-storage.js";
import { publishRealtimeAsync } from "./realtime.js";

type MediaJob = {
  id: string;
  tenant_id: string;
  media_id: string;
  attempts: number;
  conversation_id: string;
  message_id: string;
  mime_type: string;
  file_name: string | null;
  storage_provider: "local" | "r2";
  storage_key: string;
};

const TRANSCRIBABLE = /^(audio|video)\//;
const PREVIEWABLE = /^(image|video)\//;

export async function enqueueMediaProcessing(tenantId: string, mediaId: string) {
  await query(
    `insert into media_processing_jobs(tenant_id,media_id)
     values($1,$2)
     on conflict(media_id) do update set
       status=case when media_processing_jobs.status='completed' then media_processing_jobs.status else 'pending' end,
       available_at=case when media_processing_jobs.status='completed' then media_processing_jobs.available_at else now() end,
       updated_at=now()`,
    [tenantId, mediaId],
  );
}

export async function claimMediaJob(workerId: string): Promise<MediaJob | null> {
  return transaction(async () => {
    await query(
      `update media_processing_jobs set status='pending',locked_at=null,locked_by=null,updated_at=now()
       where status='processing' and locked_at < now()-interval '15 minutes'`,
    );
    const claimed = await query<MediaJob>(
      `with candidate as (
         select id from media_processing_jobs
         where status='pending' and available_at<=now() and attempts<5
         order by available_at,created_at
         for update skip locked limit 1
       )
       update media_processing_jobs job set status='processing',attempts=attempts+1,
         locked_at=now(),locked_by=$1,updated_at=now()
       from candidate where job.id=candidate.id
       returning job.id,job.tenant_id,job.media_id,job.attempts`,
      [workerId],
    );
    const job = claimed.rows[0];
    if (!job) return null;
    const media = await query<MediaJob>(
      `select $1::uuid as id,md.tenant_id,md.id as media_id,$2::int as attempts,
              md.conversation_id,m.id as message_id,md.mime_type,md.file_name,
              md.storage_provider,md.storage_key
       from message_media md
       join messages m on m.tenant_id=md.tenant_id and m.media_id=md.id
       where md.tenant_id=$3 and md.id=$4 and md.status='ready' and md.storage_key is not null`,
      [job.id, job.attempts, job.tenant_id, job.media_id],
    );
    if (!media.rows[0]) {
      await query("update media_processing_jobs set status='failed',last_error='Mídia original indisponível.',updated_at=now() where id=$1", [job.id]);
      return null;
    }
    return media.rows[0];
  });
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let error = "";
    child.stderr.on("data", (chunk) => { if (error.length < 4_000) error += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} terminou com código ${code}: ${error.slice(-1_000)}`)));
  });
}

async function transcribe(audioPath: string) {
  const baseUrl = process.env.TRANSCRIPTION_BASE_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) return null;
  const bytes = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "audio.wav");
  form.append("model", process.env.TRANSCRIPTION_MODEL?.trim() || "Systran/faster-whisper-base");
  form.append("response_format", "verbose_json");
  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: process.env.TRANSCRIPTION_API_KEY ? { Authorization: `Bearer ${process.env.TRANSCRIPTION_API_KEY}` } : undefined,
    body: form,
    signal: AbortSignal.timeout(Number(process.env.TRANSCRIPTION_TIMEOUT_MS) || 300_000),
  });
  if (!response.ok) throw new Error(`Transcrição recusada (HTTP ${response.status}).`);
  const data = await response.json() as { text?: unknown; language?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  return text ? { text: text.slice(0, 100_000), language: typeof data.language === "string" ? data.language.slice(0, 24) : null } : null;
}

export async function processMediaJob(job: MediaJob) {
  const storage = createMediaStorage();
  const temporary = await mkdtemp(join(tmpdir(), "crm-media-"));
  let preview: { provider: "local" | "r2"; key: string; mime: string } | null = null;
  try {
    const original = await storage.get({ provider: job.storage_provider, key: job.storage_key });
    const suffix = extname(job.file_name ?? "") || ".bin";
    const input = join(temporary, `input${suffix}`);
    const previewPath = join(temporary, "preview.jpg");
    const audioPath = join(temporary, "audio.wav");
    await writeFile(input, original.bytes);

    if (PREVIEWABLE.test(job.mime_type)) {
      const seek = job.mime_type.startsWith("video/") ? ["-ss", "0.2"] : [];
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...seek, "-i", input, "-vf", "scale='min(960,iw)':-2", "-frames:v", "1", "-q:v", "3", "-y", previewPath]);
      const stored = await storage.put({ tenantId: job.tenant_id, conversationId: job.conversation_id, bytes: await readFile(previewPath), mimeType: "image/jpeg", fileName: "preview.jpg" });
      preview = { provider: stored.provider, key: stored.key, mime: "image/jpeg" };
    }

    let transcript: { text: string; language: string | null } | null = null;
    if (TRANSCRIBABLE.test(job.mime_type) && process.env.TRANSCRIPTION_BASE_URL) {
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", audioPath]);
      transcript = await transcribe(audioPath);
    }

    await transaction(async () => {
      await query(
        `update message_media set preview_storage_provider=$3,preview_storage_key=$4,preview_mime_type=$5,
           transcription=$6,transcription_language=$7,processing_status='completed',processing_error=null,updated_at=now()
         where tenant_id=$1 and id=$2`,
        [job.tenant_id, job.media_id, preview?.provider ?? null, preview?.key ?? null, preview?.mime ?? null, transcript?.text ?? null, transcript?.language ?? null],
      );
      await query("update media_processing_jobs set status='completed',locked_at=null,locked_by=null,last_error=null,updated_at=now() where id=$1", [job.id]);
    });
    publishRealtimeAsync({
      type: "message.updated",
      tenantId: job.tenant_id,
      conversationId: job.conversation_id,
      data: {
        id: job.message_id,
        media_processing_status: "completed",
        media_preview_available: Boolean(preview),
        media_transcription: transcript?.text ?? null,
        media_transcription_language: transcript?.language ?? null,
      },
    });
  } catch (error) {
    if (preview) await storage.delete({ provider: preview.provider, key: preview.key }).catch(() => {});
    const reason = error instanceof Error ? error.message.slice(0, 1_000) : "Falha desconhecida no processamento.";
    const failed = job.attempts >= 5;
    await transaction(async () => {
      await query(
        `update media_processing_jobs set status=$2,available_at=now()+make_interval(secs=>$3),
           locked_at=null,locked_by=null,last_error=$4,updated_at=now() where id=$1`,
        [job.id, failed ? "failed" : "pending", Math.min(900, 30 * (2 ** Math.max(0, job.attempts - 1))), reason],
      );
      await query("update message_media set processing_status=$3,processing_error=$4,updated_at=now() where tenant_id=$1 and id=$2", [job.tenant_id, job.media_id, failed ? "failed" : "pending", reason]);
    });
    if (failed) publishRealtimeAsync({ type: "message.updated", tenantId: job.tenant_id, conversationId: job.conversation_id, data: { id: job.message_id, media_processing_status: "failed" } });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function processNextMediaJob(workerId = `media-${randomUUID()}`) {
  const job = await claimMediaJob(workerId);
  if (!job) return false;
  await processMediaJob(job);
  return true;
}
