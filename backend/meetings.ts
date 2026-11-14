import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import { query, transaction } from './db.js';
import { startMeetingWorker } from './meeting-worker.js';

type User = { id: string; tenant_id: string; name: string; role: string };
export type MeetingConfig = { url: string; apiKey: string; apiSecret: string };
type MeetingRow = { id: string; tenant_id: string; lead_id: string; contact_id: string | null; created_by: string; room_name: string; invite_hash: string; invite_expires_at: Date; status: string; analysis_status: string; started_at: Date | null; host_consent_at: Date | null };
export type MeetingDependencies = {
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
  decryptSecret: (value: string | null) => string | null;
  background?: boolean;
  config?: () => MeetingConfig | null;
  rooms?: { createRoom: (options: { name: string; maxParticipants: number; emptyTimeout: number }) => Promise<unknown>; deleteRoom: (name: string) => Promise<unknown> };
};
export function meetingConfig(): MeetingConfig | null {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = process.env;
  if (!url || !apiKey || !apiSecret) return null;
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  return { url: parsed.href.replace(/\/$/, ''), apiKey, apiSecret };
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const idFrom = (request: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(request.params).id;
const canHost = (user: User, meeting: MeetingRow) => meeting.created_by === user.id || ['admin', 'gerente', 'manager'].includes(user.role);
const publicColumns = 'id,lead_id,contact_id,created_by,status,started_at,ended_at,capture_incomplete,analysis_status,assessment,analysis_error,model,created_at';
const MAX_AUDIO = 2 * 1024 * 1024;

export function registerMeetingRoutes(app: FastifyInstance, deps: MeetingDependencies) {
  const getConfig = deps.config ?? meetingConfig;
  const roomService = () => {
    if (deps.rooms) return deps.rooms;
    const config = getConfig();
    if (!config) throw Object.assign(new Error('O serviço de reuniões ainda não foi configurado.'), { statusCode: 503 });
    return new RoomServiceClient(config.url.replace(/^ws/, 'http'), config.apiKey, config.apiSecret, { requestTimeout: 8 });
  };
  const getMeeting = async (user: User, id: string, lock = false) => (await query<MeetingRow>(`select * from lead_meetings where tenant_id=$1 and id=$2 ${lock ? 'for update' : ''}`, [user.tenant_id, id])).rows[0];
  const authorize = async (request: FastifyRequest, reply: FastifyReply, hosting = false) => {
    const user = await deps.requireAuth(request, reply);
    if (!user) return null;
    const meeting = await getMeeting(user, idFrom(request));
    if (!meeting) { reply.code(404).send({ error: 'Reunião não encontrada.' }); return null; }
    if (hosting && !canHost(user, meeting)) { reply.code(403).send({ error: 'Somente o responsável pela reunião ou um gestor pode conduzi-la.' }); return null; }
    return { user, meeting };
  };
  // Parse only audio types; other routes keep their normal JSON parser.
  app.addContentTypeParser(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'], { parseAs: 'buffer', bodyLimit: MAX_AUDIO }, (_request, body, done) => done(null, body));

  app.get('/api/leads/:id/meetings', async (request, reply) => {
    const user = await deps.requireAuth(request, reply); if (!user) return;
    const lead = (await query('select id from leads where tenant_id=$1 and id=$2', [user.tenant_id, idFrom(request)])).rows[0];
    if (!lead) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    const meetings = await query(`select ${publicColumns} from lead_meetings where tenant_id=$1 and lead_id=$2 order by created_at desc limit 30`, [user.tenant_id, idFrom(request)]);
    return { configured: Boolean(getConfig()), meetings: meetings.rows };
  });
  app.post('/api/leads/:id/meetings', async (request, reply) => {
    const user = await deps.requireAuth(request, reply); if (!user) return;
    const lead = (await query<{ contact_id: string | null }>('select contact_id from leads where tenant_id=$1 and id=$2', [user.tenant_id, idFrom(request)])).rows[0];
    if (!lead) return reply.code(404).send({ error: 'Oportunidade não encontrada.' });
    if (!getConfig()) return reply.code(503).send({ error: 'O serviço de reuniões ainda não foi configurado.' });
    const inviteToken = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const result = await query(`insert into lead_meetings(id,tenant_id,lead_id,contact_id,created_by,room_name,invite_hash,invite_expires_at)
      select $1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours' where
      (select count(*) from lead_meetings where tenant_id=$2 and status <> 'ended') < 20 returning ${publicColumns}`,
      [id, user.tenant_id, idFrom(request), lead.contact_id, user.id, `crm_${id.replaceAll('-', '')}`, hash(inviteToken)]);
    if (!result.rows[0]) return reply.code(429).send({ error: 'Encerre reuniões anteriores antes de criar outra.' });
    return reply.code(201).send({ meeting: result.rows[0], inviteToken });
  });
  app.get('/api/meetings/:id', async (request, reply) => {
    const access = await authorize(request, reply); if (!access) return;
    const { user, meeting } = access;
    const detail = (await query(`select ${publicColumns} from lead_meetings where tenant_id=$1 and id=$2`, [user.tenant_id, meeting.id])).rows[0];
    const segments = await query('select id,speaker,start_ms,duration_ms,text,status,error from meeting_audio_chunks where tenant_id=$1 and meeting_id=$2 order by start_ms,created_at', [user.tenant_id, meeting.id]);
    const reviews = await query('select r.id,r.verdict,r.note,r.created_at,u.name as user_name from meeting_reviews r left join users u on u.id=r.user_id and u.tenant_id=r.tenant_id where r.tenant_id=$1 and r.meeting_id=$2 order by r.created_at desc limit 20', [user.tenant_id, meeting.id]);
    return { meeting: detail, segments: segments.rows, reviews: reviews.rows, canHost: canHost(user, meeting) };
  });
  app.post('/api/meetings/:id/invite', async (request, reply) => {
    const access = await authorize(request, reply, true); if (!access) return;
    if (access.meeting.status === 'ended') return reply.code(410).send({ error: 'Esta reunião já foi encerrada.' });
    const inviteToken = randomBytes(32).toString('base64url');
    await query("update lead_meetings set invite_hash=$3,invite_expires_at=now()+interval '24 hours',updated_at=now() where tenant_id=$1 and id=$2 and status<>'ended'", [access.user.tenant_id, access.meeting.id, hash(inviteToken)]);
    return { inviteToken };
  });
  app.post('/api/meetings/:id/join', async (request, reply) => {
    const input = z.object({ inviteToken: z.string().min(40).max(60).optional(), name: z.string().trim().min(1).max(80).optional(), consent: z.literal(true) }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'Informe seu nome e aceite a transcrição para entrar.' });
    const config = getConfig();
    if (!config) return reply.code(503).send({ error: 'O serviço de reuniões ainda não foi configurado.' });
    let meeting: MeetingRow, role: 'host' | 'guest', name: string;
    if (input.data.inviteToken) {
      const found = (await query<MeetingRow>('select * from lead_meetings where id=$1', [idFrom(request)])).rows[0];
      const expected = Buffer.from(found?.invite_hash ?? '0'.repeat(64), 'hex');
      const provided = Buffer.from(hash(input.data.inviteToken), 'hex');
      if (!found || expected.length !== provided.length || !timingSafeEqual(expected, provided)) return reply.code(404).send({ error: 'Convite inválido.' });
      if (found.status === 'ended' || new Date(found.invite_expires_at).getTime() <= Date.now()) return reply.code(410).send({ error: 'Este convite expirou ou a reunião terminou.' });
      if (!input.data.name) return reply.code(400).send({ error: 'Informe seu nome para entrar.' });
      meeting = found; role = 'guest'; name = input.data.name;
    } else {
      const access = await authorize(request, reply, true); if (!access) return;
      meeting = access.meeting; role = 'host'; name = access.user.name;
      if (meeting.status === 'ended') return reply.code(410).send({ error: 'Esta reunião já foi encerrada.' });
    }
    try { await roomService().createRoom({ name: meeting.room_name, maxParticipants: 2, emptyTimeout: 300 }); }
    catch { return reply.code(503).send({ error: 'O serviço de vídeo não respondeu. Tente novamente.' }); }
    // A stable identity per role prevents duplicate tabs from capturing the same call twice.
    const token = new AccessToken(config.apiKey, config.apiSecret, { identity: `${role}_${meeting.id}`, name, ttl: '15m' });
    token.addGrant({ room: meeting.room_name, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
    const updated = await query(`update lead_meetings set status='active',started_at=coalesce(started_at,now()),
      host_consent_at=case when $3='host' then now() else host_consent_at end,
      guest_consent_at=case when $3='guest' then now() else guest_consent_at end,
      guest_name=case when $3='guest' then $4 else guest_name end,
      capture_incomplete=capture_incomplete or ($3='host' and host_consent_at is not null),updated_at=now()
      where tenant_id=$1 and id=$2 and status<>'ended' returning started_at`, [meeting.tenant_id, meeting.id, role, name]);
    if (!updated.rows[0]) {
      try { await roomService().deleteRoom(meeting.room_name); } catch { /* The meeting remains closed in the CRM. */ }
      return reply.code(410).send({ error: 'Esta reunião já foi encerrada.' });
    }
    return { token: await token.toJwt(), url: config.url, role, name, startedAt: updated.rows[0].started_at };
  });
  app.post('/api/meetings/:id/audio', { bodyLimit: MAX_AUDIO }, async (request, reply) => {
    const access = await authorize(request, reply, true); if (!access) return;
    if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Envie um bloco de áudio.' });
    const input = z.object({ chunkId: z.string().uuid(), speaker: z.enum(['host','guest']), startMs: z.coerce.number().int().min(0).max(7200000), durationMs: z.coerce.number().int().min(1).max(25000) }).strict().parse(request.query);
    const mime = request.headers['content-type']?.split(';')[0];
    if (!mime || !['audio/webm','audio/ogg','audio/mp4','audio/wav'].includes(mime) || request.body.length < 16 || request.body.length > MAX_AUDIO) return reply.code(415).send({ error: 'Bloco de áudio inválido.' });
    const audio = request.body;
    const result = await transaction(async () => {
      const current = await getMeeting(access.user, access.meeting.id, true);
      if (!current || current.status !== 'active' || !current.host_consent_at) return 409;
      const existing = await query('select id from meeting_audio_chunks where tenant_id=$1 and meeting_id=$2 and id=$3', [access.user.tenant_id, current.id, input.chunkId]);
      if (existing.rows.length) return 202;
      const count = await query<{ count: string }>('select count(*) from meeting_audio_chunks where tenant_id=$1 and meeting_id=$2', [access.user.tenant_id, current.id]);
      if (Number(count.rows[0].count) >= 360) return 429;
      await query('insert into meeting_audio_chunks(id,tenant_id,meeting_id,speaker,start_ms,duration_ms,mime_type,audio) values($1,$2,$3,$4,$5,$6,$7,$8)', [input.chunkId, access.user.tenant_id, current.id, input.speaker, input.startMs, input.durationMs, mime, audio]);
      return 202;
    });
    return reply.code(result).send(result === 202 ? { accepted: true } : { error: result === 429 ? 'Limite de áudio desta reunião atingido.' : 'A reunião precisa estar em andamento para receber áudio.' });
  });
  app.post('/api/meetings/:id/capture-error', async (request, reply) => {
    const access = await authorize(request, reply, true); if (!access) return;
    await query("update lead_meetings set capture_incomplete=true,updated_at=now() where tenant_id=$1 and id=$2 and status='active'", [access.user.tenant_id, access.meeting.id]);
    return { ok: true };
  });
  app.post('/api/meetings/:id/end', async (request, reply) => {
    const access = await authorize(request, reply, true); if (!access) return;
    const { captureComplete } = z.object({ captureComplete: z.boolean().default(false) }).strict().parse(request.body ?? {});
    await transaction(async () => {
      await getMeeting(access.user, access.meeting.id, true);
      await query("update lead_meetings set status='ended',ended_at=coalesce(ended_at,now()),analysis_status=case when status<>'ended' then 'queued' else analysis_status end,capture_incomplete=capture_incomplete or (status<>'ended' and not $3),updated_at=now() where tenant_id=$1 and id=$2", [access.user.tenant_id, access.meeting.id, captureComplete]);
    });
    // Database closure is authoritative even if the media service is unavailable.
    try { await roomService().deleteRoom(access.meeting.room_name); } catch { /* Guests also see disconnection when the room is removed. */ }
    return { ok: true };
  });
  app.post('/api/meetings/:id/retry', async (request, reply) => {
    const access = await authorize(request, reply, true); if (!access) return;
    await transaction(async () => {
      const current = await getMeeting(access.user, access.meeting.id, true);
      if (current.analysis_status === 'processing') throw Object.assign(new Error('A análise já está em andamento.'), { statusCode: 409 });
      await query("update meeting_audio_chunks set status='queued',error=null where tenant_id=$1 and meeting_id=$2 and status='failed' and audio is not null", [access.user.tenant_id, access.meeting.id]);
      await query("update lead_meetings set analysis_status=case when status='ended' then 'queued' else 'idle' end,analysis_error=null,updated_at=now() where tenant_id=$1 and id=$2", [access.user.tenant_id, access.meeting.id]);
    });
    return { ok: true };
  });
  app.post('/api/meetings/:id/review', async (request, reply) => {
    const access = await authorize(request, reply); if (!access) return;
    const input = z.object({ verdict: z.enum(['qualified','disqualified','insufficient_data']), note: z.string().trim().min(5).max(2000) }).strict().parse(request.body);
    if (access.meeting.analysis_status !== 'complete') return reply.code(409).send({ error: 'Aguarde a avaliação antes de registrar uma revisão.' });
    const review = await query('insert into meeting_reviews(tenant_id,meeting_id,user_id,verdict,note) values($1,$2,$3,$4,$5) returning id,verdict,note,created_at', [access.user.tenant_id, access.meeting.id, access.user.id, input.verdict, input.note]);
    return reply.code(201).send({ review: review.rows[0] });
  });
  if (deps.background !== false) startMeetingWorker(app, deps.decryptSecret);
}
