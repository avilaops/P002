import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { query, transaction } from './db.js'
import { evolutionAddress, evolutionMessage } from './evolution-history.js'
import { createMediaStorage } from './media-storage.js'
import { maxMediaBytes, persistBytes } from './whatsapp-media.js'

export type EvolutionConfig = { baseUrl: string; apiKey: string; tenantId: string; instanceName: string }
type User = { tenant_id: string; role: string }
type Json = Record<string, any>
type Dependencies = {
  config?: (tenantId: string) => EvolutionConfig | null
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<User | null | undefined>
  canManage: (user: any) => boolean
  fetch?: typeof fetch
  query?: typeof query
  upsertContact?: (tenantId: string, phone: string, name: string | undefined) => Promise<string>
  conversation?: (tenantId: string, channelId: string | null, contactId: string) => Promise<string>
  publish?: (event: any) => void
  background?: boolean
}

export function evolutionConfig(requestedTenantId?: string): EvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  const boundTenantId = process.env.EVOLUTION_TENANT_ID?.trim()
  if (boundTenantId && requestedTenantId && boundTenantId !== requestedTenantId) return null
  const tenantId = boundTenantId || requestedTenantId
  if (!tenantId || !/^[a-f0-9-]{36}$/i.test(tenantId)) return null
  const instanceName = boundTenantId ? process.env.EVOLUTION_INSTANCE_NAME?.trim() : `crm_${tenantId.replaceAll('-', '')}`
  if (!baseUrl || !apiKey || !tenantId || !instanceName) return null
  let url: URL
  try { url = new URL(baseUrl) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(instanceName)) return null
  return { baseUrl, apiKey, tenantId, instanceName }
}

export class EvolutionError extends Error {
  constructor(message = 'Não foi possível comunicar com a Evolution API.', public status = 502) { super(message) }
}

export function evolutionWebhookSecret(config: EvolutionConfig) {
  return createHmac('sha256', config.apiKey)
    .update(`avila-crm:evolution-webhook:${config.tenantId}:${config.instanceName}`)
    .digest('hex')
}

export function evolutionWebhookUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, '')
  if (!configured) return null
  try {
    const url = new URL(configured)
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    return `${url.origin}/api/integrations/evolution/webhook`
  } catch { return null }
}

function secureEqual(expected: string, received: string | string[] | undefined) {
  if (typeof received !== 'string') return false
  const left = Buffer.from(expected, 'utf8')
  const right = Buffer.from(received, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createEvolutionClient(config: EvolutionConfig, transport: typeof fetch = fetch) {
  async function request(path: string, body?: unknown): Promise<Json | Json[]> {
    try {
      const response = await transport(`${config.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: config.apiKey, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new EvolutionError(`A Evolution API recusou a operação (HTTP ${response.status}).`, response.status === 404 ? 404 : 502)
      const data = await response.json()
      if (!data || typeof data !== 'object') throw new EvolutionError('Resposta inválida da Evolution API.')
      return data as Json
    } catch (error) {
      if (error instanceof EvolutionError) throw error
      throw new EvolutionError()
    }
  }
  const instance = encodeURIComponent(config.instanceName)
  return {
    request,
    async sendText(number: string, text: string) {
      const address = evolutionAddress(number.includes('@') ? number : `${number.replace(/\D/g, '')}@s.whatsapp.net`)
      if (!address) throw new EvolutionError('Evolution API: destinatário do WhatsApp inválido.', 400)
      const data = await request(`/message/sendText/${instance}`, { number: address, text }) as Json
      if (typeof data.key?.id !== 'string' || !data.key.id) throw new EvolutionError('A Evolution API não confirmou o envio.')
      return data.key.id as string
    },
    async status() {
      const data = await request(`/instance/connectionState/${instance}`) as Json
      const state = data.instance?.state
      if (!['open', 'connecting', 'close', 'closed'].includes(state)) throw new EvolutionError('Estado inválido da Evolution API.')
      const instances = await request(`/instance/fetchInstances?instanceName=${instance}`)
      if (!Array.isArray(instances)) throw new EvolutionError('Resposta inválida da Evolution API.')
      const own = instances.find((item) => (item.name ?? item.instance?.instanceName) === config.instanceName)
      const owner = own?.ownerJid ?? own?.instance?.owner
      return { state: state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected', phone: typeof owner === 'string' ? owner.split('@')[0] : null }
    },
    async connect() {
      let state
      try { state = await this.status() } catch (error) {
        if (!(error instanceof EvolutionError) || error.status !== 404) throw error
        await request('/instance/create', { instanceName: config.instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true, syncFullHistory: true, groupsIgnore: false })
      }
      if (state?.state === 'connected') return { ...state, qrCode: null }
      const data = await request(`/instance/connect/${instance}`) as Json
      const base64 = data.base64 ?? data.qrcode?.base64
      const qrCode = typeof base64 === 'string' && /^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(base64) && base64.length < 500_000 ? base64 : null
      return { state: 'connecting', phone: null, qrCode }
    },
    async messages(page = 1) {
      const data = await request(`/chat/findMessages/${instance}`, { where: {}, page, offset: 100 }) as Json
      const records = data.messages?.records ?? (Array.isArray(data.messages) ? data.messages : null)
      if (!Array.isArray(records)) throw new EvolutionError('Lista de mensagens inválida da Evolution API.')
      const pages = Number(data.messages?.pages)
      const total = Number(data.messages?.total)
      return { records: records as Json[], total: Number.isFinite(total) ? total : null, hasMore: Number.isFinite(pages) ? page < pages : records.length >= 100 }
    },
    async media(item: Json) {
      const data = await request(`/chat/getBase64FromMediaMessage/${instance}`, { message: { key: item.key }, convertToMp4: false }) as Json
      const encoded = typeof data.base64 === 'string' ? data.base64.replace(/^data:[^;]+;base64,/, '') : ''
      if (!encoded || encoded.length > Math.ceil(maxMediaBytes() * 4 / 3) + 4 || !/^[a-zA-Z0-9+/=\r\n]+$/.test(encoded)) throw new EvolutionError('Arquivo não disponível ou acima do limite de mídia.')
      const bytes = Buffer.from(encoded, 'base64')
      if (!bytes.length || bytes.length > maxMediaBytes()) throw new EvolutionError('Arquivo acima do limite de mídia.')
      return bytes
    },
    async profilePictureUrl(number: string) {
      const address = evolutionAddress(number.includes('@') ? number : `${number.replace(/\D/g, '')}@s.whatsapp.net`)
      if (!address || address.endsWith('@g.us')) return null
      try {
        const data = await request(`/chat/fetchProfilePictureUrl/${instance}`, { number: address }) as Json
        const candidate = data.profilePictureUrl ?? data.picture ?? data.url
        if (typeof candidate !== 'string') return null
        const url = new URL(candidate)
        if (url.protocol !== 'https:' || url.username || url.password) return null
        return url.toString()
      } catch (error) {
        if (error instanceof EvolutionError && error.status === 404) return null
        throw error
      }
    },
    async configureWebhook(url: string, secret: string) {
      const data = await request(`/webhook/set/${instance}`, {
        webhook: {
          enabled: true,
          url,
          headers: { 'x-avila-webhook-token': secret },
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE'],
        },
      }) as Json
      return data
    },
  }
}

export async function sendEvolutionText(tenantId: string, instanceName: string, number: string, text: string) {
  const config = evolutionConfig(tenantId)
  if (!config || config.tenantId !== tenantId || config.instanceName !== instanceName) throw new EvolutionError('Evolution API não configurada para este canal.', 503)
  return createEvolutionClient(config).sendText(number, text)
}

export function registerEvolutionRoutes(app: FastifyInstance, deps: Dependencies) {
  const db = deps.query ?? query
  const transact = deps.query ? async <T>(work: () => Promise<T>) => work() : transaction
  const enqueueMedia = (tenantId: string, mediaId: string) => db(
    `insert into media_processing_jobs(tenant_id,media_id) values($1,$2)
     on conflict(media_id) do update set status=case when media_processing_jobs.status='completed' then 'completed' else 'pending' end,
       available_at=case when media_processing_jobs.status='completed' then media_processing_jobs.available_at else now() end,updated_at=now()`,
    [tenantId, mediaId],
  )
  const syncing = new Set<string>()
  const avatarSyncing = new Set<string>()
  async function syncAvatar(config: EvolutionConfig, client: ReturnType<typeof createEvolutionClient>, contactId: string, conversationId: string, phone: string) {
    if (avatarSyncing.has(contactId)) return
    avatarSyncing.add(contactId)
    try {
      const current = await db<{ avatar_storage_provider: 'local' | 'r2' | null; avatar_storage_key: string | null; avatar_synced_at: string | null }>(
        `select avatar_storage_provider,avatar_storage_key,avatar_synced_at from contacts
         where tenant_id=$1 and id=$2`, [config.tenantId, contactId],
      )
      const contact = current.rows[0]
      if (!contact || (contact.avatar_synced_at && Date.now() - new Date(contact.avatar_synced_at).getTime() < 7 * 86_400_000)) return
      const pictureUrl = await client.profilePictureUrl(phone)
      if (!pictureUrl) {
        await db('update contacts set avatar_synced_at=now() where tenant_id=$1 and id=$2', [config.tenantId, contactId])
        return
      }
      const response = await (deps.fetch ?? fetch)(pictureUrl, { redirect: 'follow', signal: AbortSignal.timeout(12_000) })
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      const declared = Number(response.headers.get('content-length'))
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || (Number.isFinite(declared) && declared > 5 * 1024 * 1024)) throw new Error('Avatar inválido.')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Avatar acima do limite.')
      const storage = createMediaStorage()
      const stored = await storage.put({ tenantId: config.tenantId, conversationId, bytes, mimeType: mime, fileName: `avatar.${mime.split('/')[1]}` })
      await db(
        `update contacts set avatar_storage_provider=$3,avatar_storage_key=$4,avatar_mime_type=$5,avatar_synced_at=now(),updated_at=now()
         where tenant_id=$1 and id=$2`, [config.tenantId, contactId, stored.provider, stored.key, mime],
      )
      if (contact.avatar_storage_provider && contact.avatar_storage_key) {
        await storage.delete({ provider: contact.avatar_storage_provider, key: contact.avatar_storage_key }).catch(() => {})
      }
      deps.publish?.({ type: 'conversation.updated', tenantId: config.tenantId, conversationId, data: { id: conversationId, contact_avatar_url: `/api/contacts/${contactId}/avatar` } })
    } catch {
      await db('update contacts set avatar_synced_at=now() where tenant_id=$1 and id=$2', [config.tenantId, contactId]).catch(() => {})
    } finally { avatarSyncing.delete(contactId) }
  }
  async function syncProgress(config: EvolutionConfig) {
    const result = await db('select metadata from channels where tenant_id=$1 and provider=\'evolution\' and external_id=$2', [config.tenantId, config.instanceName])
    return { state: 'idle', historyPage: 1, total: null, imported: 0, inspected: 0, lastSuccessAt: null, error: null, historyComplete: false, ...result.rows[0]?.metadata?.evolutionSync }
  }
  async function saveProgress(config: EvolutionConfig, progress: Json) {
    await db(`update channels set metadata=jsonb_set(metadata,'{evolutionSync}',$3::jsonb),updated_at=now() where tenant_id=$1 and provider='evolution' and external_id=$2`, [config.tenantId, config.instanceName, JSON.stringify(progress)])
  }
  async function saveWebhookHealth(config: EvolutionConfig, health: Json) {
    await db(
      `update channels set metadata=jsonb_set(metadata,'{evolutionWebhook}',$3::jsonb),updated_at=now()
       where tenant_id=$1 and provider='evolution' and external_id=$2`,
      [config.tenantId, config.instanceName, JSON.stringify(health)],
    )
  }
  async function ensureWebhook(config: EvolutionConfig, client: ReturnType<typeof createEvolutionClient>) {
    const url = evolutionWebhookUrl()
    if (!url) return false
    try {
      await client.configureWebhook(url, evolutionWebhookSecret(config))
      await saveWebhookHealth(config, { state: 'connected', url, lastConfiguredAt: new Date().toISOString(), error: null })
      return true
    } catch (error) {
      await saveWebhookHealth(config, {
        state: 'error',
        url,
        lastAttemptAt: new Date().toISOString(),
        error: error instanceof EvolutionError ? error.message : 'Não foi possível configurar a atualização em tempo real.',
      }).catch(() => {})
      return false
    }
  }
  async function retryFailedMedia(config: EvolutionConfig, client: ReturnType<typeof createEvolutionClient>, item: Json) {
    // Claim the attempt atomically. updated_at is also the persisted backoff,
    // including across restarts and simultaneous workers. Never stop retrying
    // solely because a provider download failed earlier.
    const claim = await db(`update message_media as media set updated_at=now()
      from messages as message
      where media.tenant_id=$1 and media.external_id=$2 and media.status='failed'
        and media.updated_at <= now()-interval '1 minute'
        and message.tenant_id=media.tenant_id and message.media_id=media.id
      returning media.id,media.mime_type,media.file_name,message.id as message_id,message.conversation_id`, [config.tenantId, item.key.id])
    const media = claim.rows[0]
    if (!media?.message_id || !media?.conversation_id) return
    try {
      const bytes = await client.media(item)
      const stored = await persistBytes(config.tenantId, media.conversation_id, bytes, media.mime_type, media.file_name)
      await transact(async () => {
        await db(`update message_media set file_size=$3,storage_provider=$4,storage_key=$5,storage_path=case when $4='local' then $5 else null end,sha256=$6,status='ready',error_message=null,updated_at=now() where tenant_id=$1 and id=$2`, [config.tenantId, media.id, bytes.length, stored.provider, stored.key, stored.sha256])
        await db(`update messages set metadata=metadata||'{"mediaUnavailable":false}'::jsonb where tenant_id=$1 and id=$2`, [config.tenantId, media.message_id])
        await enqueueMedia(config.tenantId, media.id)
      })
      deps.publish?.({ type: 'message.updated', tenantId: config.tenantId, conversationId: media.conversation_id, data: { id: media.message_id, media_id: media.id, media_status: 'ready', media_mime_type: media.mime_type, media_file_name: media.file_name, media_file_size: bytes.length } })
    } catch { /* The claim timestamp schedules the next attempt automatically. */ }
  }

  async function access(request: FastifyRequest, reply: FastifyReply, manage = false) {
    const user = await deps.requireAuth(request, reply)
    if (!user) return null
    const config = (deps.config ?? evolutionConfig)(user.tenant_id)
    if (!config) { reply.code(503).send({ error: 'Evolution API ainda não configurada para este ambiente.', code: 'evolution_not_configured' }); return null }
    if (config.tenantId !== user.tenant_id || (manage && !deps.canManage(user))) { reply.code(403).send({ error: 'Sem permissão para esta conexão.' }); return null }
    return { config, client: createEvolutionClient(config, deps.fetch) }
  }
  async function channel(config: EvolutionConfig, state: { state: string; phone: string | null }) {
    const result = await db<{ id: string }>(
      `insert into channels(tenant_id,provider,external_id,display_name,phone_number,status,last_sync_at,metadata)
       values($1,'evolution',$2,'WhatsApp Web',$3,$4,now(),'{"source":"evolution-api"}')
       on conflict(tenant_id,provider,external_id) do update set phone_number=coalesce(excluded.phone_number,channels.phone_number),status=excluded.status,metadata=channels.metadata||excluded.metadata,last_sync_at=now(),updated_at=now()
       returning id`, [config.tenantId, config.instanceName, state.phone, state.state],
    )
    return result.rows[0].id
  }
  function failure(reply: FastifyReply, error: unknown) {
    const known = error instanceof EvolutionError ? error : new EvolutionError()
    return reply.code(known.status).send({ error: known.message, code: 'evolution_unavailable' })
  }

  app.get('/api/integrations/evolution/status', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const connection = await access(request, reply)
    if (!connection) return
    try {
      let status
      try { status = await connection.client.status() } catch (error) {
        if (!(error instanceof EvolutionError) || error.status !== 404) throw error
        await db("update channels set status='disconnected',updated_at=now() where tenant_id=$1 and provider='evolution' and external_id=$2", [connection.config.tenantId, connection.config.instanceName])
        return { configured: true, instanceName: connection.config.instanceName, channelId: null, state: 'disconnected', phone: null }
      }
      const channelId = await channel(connection.config, status)
      if (status.state === 'connected') void ensureWebhook(connection.config, connection.client)
      return { configured: true, instanceName: connection.config.instanceName, channelId, ...status, sync: await syncProgress(connection.config) }
    } catch (error) { return failure(reply, error) }
  })

  app.post('/api/integrations/evolution/connect', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const connection = await access(request, reply, true)
    if (!connection) return
    try {
      const status = await connection.client.connect()
      await channel(connection.config, status)
      if (status.state === 'connected') void ensureWebhook(connection.config, connection.client)
      return { instanceName: connection.config.instanceName, ...status }
    } catch (error) { return failure(reply, error) }
  })

  async function synchronize(config: EvolutionConfig, client: ReturnType<typeof createEvolutionClient>) {
    if (syncing.has(config.tenantId)) throw new EvolutionError('Sincronização já em andamento.', 409)
    syncing.add(config.tenantId)
    let progress: Json = { state: 'idle', imported: 0, inspected: 0 }
    try {
      progress = await syncProgress(config)
      const status = await client.status()
      const channelId = await channel(config, status)
      if (status.state !== 'connected') throw new EvolutionError('Conecte o WhatsApp antes de sincronizar.', 409)
      if (!deps.upsertContact || !deps.conversation) throw new EvolutionError()
      progress = { ...progress, state: 'syncing', error: null }
      await saveProgress(config, progress)
      let imported = 0
      let inspected = 0
      const importedBefore = Number(progress.imported) || 0
      const inspectedBefore = Number(progress.inspected) || 0
      const deadline = Date.now() + 20_000
      let exhausted = false
      // Refresh the head on every cycle and resume the backfill independently.
      // Repeating complete scans also picks up historical records arriving late.
      const cursor = Math.max(1, Number(progress.historyPage) || 1)
      const pages = cursor === 1 ? [1, 2, 3, 4, 5] : [1, cursor, cursor + 1, cursor + 2, cursor + 3]
      for (const page of pages) {
      const batch = await client.messages(page)
      progress.total = batch.total
      for (const item of [...batch.records].reverse()) {
        inspected++
        const parsed = evolutionMessage(item)
        if (!parsed) continue
        const { address: phone, externalId, text, type, fromMe, sentAt } = parsed
        const exists = await db('select id from messages where tenant_id=$1 and external_id=$2', [config.tenantId, externalId])
        if (exists.rows.length) {
          if (deps.background === true && !phone.endsWith('@g.us')) {
            const known = await db<{ conversation_id: string; contact_id: string }>(
              `select m.conversation_id,c.contact_id from messages m
               join conversations c on c.tenant_id=m.tenant_id and c.id=m.conversation_id
               where m.tenant_id=$1 and m.external_id=$2 and c.contact_id is not null`, [config.tenantId, externalId],
            )
            if (known.rows[0]) void syncAvatar(config, client, known.rows[0].contact_id, known.rows[0].conversation_id, phone)
          }
          if (parsed.media) await retryFailedMedia(config, client, item)
          if (Date.now() >= deadline) { exhausted = true; break }
          continue
        }
        const contactId = await deps.upsertContact!(config.tenantId, phone, phone.endsWith('@g.us') ? `Grupo ${phone.split('@')[0]}` : !fromMe && typeof item.pushName === 'string' ? item.pushName : undefined)
        const conversationId = await deps.conversation!(config.tenantId, channelId, contactId)
        if (deps.background === true && !phone.endsWith('@g.us')) void syncAvatar(config, client, contactId, conversationId, phone)
        // Download before opening the database transaction. Expired attachments
        // remain visible with an explicit failure instead of disappearing.
        let attachment: { mime: string; name: string | null; size: number | null; provider: 'local' | 'r2'; key: string | null; path: string | null; sha: string | null; error: string | null } | null = null
        if (parsed.media) {
          const mime = typeof parsed.media.mimetype === 'string' ? parsed.media.mimetype : 'application/octet-stream'
          const name = typeof parsed.media.fileName === 'string' ? parsed.media.fileName.slice(0, 180) : null
          attachment = { mime, name, size: null, provider: 'local', key: null, path: null, sha: null, error: 'Arquivo não disponibilizado pela conexão do WhatsApp.' }
          try {
            const bytes = await client.media(item)
            const stored = await persistBytes(config.tenantId, conversationId, bytes, mime, name)
            attachment = { mime, name, size: bytes.length, provider: stored.provider, key: stored.key, path: stored.provider === 'local' ? stored.key : null, sha: stored.sha256, error: null }
          } catch { /* Keep the message and expose attachment unavailability. */ }
        }
        let saved
        try {
          saved = await transact(async () => {
          await db("select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2,0))", [config.tenantId, phone])
          const duplicate = await db('select id from messages where tenant_id=$1 and external_id=$2', [config.tenantId, externalId])
          if (duplicate.rows.length) return null
          const result = await db(
            `insert into messages(tenant_id,conversation_id,external_id,direction,sender_name,sender_phone,body,message_type,status,sent_at,metadata)
             values($1,$2,$3,$4,$5,$6,$7,$10,$8,$9,$11::jsonb) on conflict(tenant_id,external_id) do nothing returning *`,
            [config.tenantId, conversationId, externalId, fromMe ? 'outbound' : 'inbound', fromMe ? 'WhatsApp Web' : item.pushName ?? phone, fromMe ? status.phone : phone, text, fromMe ? 'sent' : 'received', sentAt, type, JSON.stringify({ source: 'evolution-api', remoteJid: parsed.jid, participant: item.key.participant ?? null, mediaUnavailable: !!attachment?.error })],
          )
          if (!result.rows.length) return null
          if (attachment) {
            const media = await db(`insert into message_media(tenant_id,conversation_id,direction,external_id,mime_type,file_name,file_size,storage_provider,storage_key,storage_path,sha256,caption,status,error_message) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict(tenant_id,external_id) where external_id is not null do update set updated_at=now() returning id`, [config.tenantId, conversationId, fromMe ? 'outbound' : 'inbound', externalId, attachment.mime, attachment.name, attachment.size, attachment.provider, attachment.key, attachment.path, attachment.sha, parsed.media?.caption ?? null, attachment.error ? 'failed' : 'ready', attachment.error])
            await db('update messages set media_id=$3 where tenant_id=$1 and id=$2', [config.tenantId, result.rows[0].id, media.rows[0].id])
            if (!attachment.error) await enqueueMedia(config.tenantId, media.rows[0].id)
            Object.assign(result.rows[0], { media_id: media.rows[0].id, media_status: attachment.error ? 'failed' : 'ready', media_mime_type: attachment.mime, media_file_name: attachment.name, media_file_size: attachment.size, media_caption: parsed.media?.caption ?? null })
          }
          const conversation = await db(`update conversations set status=case when $3::timestamptz>=coalesce(last_message_at,$3::timestamptz) then case when $4 then 'open' else 'waiting' end else status end,unread_count=unread_count+case when $4 or $3::timestamptz<=coalesce(last_read_at,'epoch'::timestamptz) or $5 then 0 else 1 end,last_message_at=greatest(last_message_at,$3::timestamptz),last_customer_message_at=case when $4 then last_customer_message_at else greatest(last_customer_message_at,$3::timestamptz) end,last_agent_message_at=case when $4 then greatest(last_agent_message_at,$3::timestamptz) else last_agent_message_at end,updated_at=now() where tenant_id=$1 and id=$2 returning id,status,unread_count,last_message_at,last_customer_message_at,last_agent_message_at`, [config.tenantId, conversationId, sentAt, fromMe, item.status === 'READ' || item.status === 'PLAYED'])
          return { conversationId, message: result.rows[0], conversation: conversation.rows[0] }
          })
        } catch (error) {
          if (attachment?.key) await createMediaStorage().delete({ provider: attachment.provider, key: attachment.key }).catch(() => {})
          throw error
        }
        if (!saved) {
          if (attachment?.key) await createMediaStorage().delete({ provider: attachment.provider, key: attachment.key }).catch(() => {})
          continue
        }
        imported++
        deps.publish?.({ type: 'message.created', tenantId: config.tenantId, conversationId: saved.conversationId, data: { ...saved.message, historyImport: true } })
        deps.publish?.({ type: 'conversation.updated', tenantId: config.tenantId, conversationId: saved.conversationId, data: { ...saved.conversation, id: saved.conversationId } })
        if (Date.now() >= deadline) { exhausted = true; break }
      }
      if (exhausted) {
        if (page !== 1 || cursor === 1) progress.historyPage = page
        progress.historyComplete = false
      } else if (page !== 1 || cursor === 1) {
        progress.historyPage = batch.hasMore ? page + 1 : 1
        progress.historyComplete = !batch.hasMore
      }
      progress.imported = importedBefore + imported
      progress.inspected = inspectedBefore + inspected
      await saveProgress(config, progress)
      if (exhausted || (!batch.hasMore && (page !== 1 || cursor === 1))) break
      }
      progress = { ...progress, state: 'idle', lastSuccessAt: new Date().toISOString(), error: null }
      await saveProgress(config, progress)
      return { imported, inspected, sync: progress }
    } catch (error) {
      await saveProgress(config, { ...progress, state: 'error', error: error instanceof EvolutionError ? error.message : 'Não foi possível importar as mensagens. A sincronização tentará novamente automaticamente.' }).catch(() => {})
      throw error
    } finally { syncing.delete(config.tenantId) }
  }

  app.post('/api/integrations/evolution/sync', async (request, reply) => {
    const connection = await access(request, reply, true)
    if (!connection) return
    try { return await synchronize(connection.config, connection.client) } catch (error) { return failure(reply, error) }
  })

  app.post('/api/integrations/evolution/webhook', async (request, reply) => {
    const payload = request.body as Json | null
    const instanceName = typeof payload?.instance === 'string' ? payload.instance : ''
    const event = typeof payload?.event === 'string' ? payload.event.toLowerCase() : ''
    if (!instanceName || !/^[a-zA-Z0-9_-]{1,120}$/.test(instanceName)) return reply.code(400).send({ error: 'Evento inválido.' })
    const found = await db<{ tenant_id: string }>(
      `select tenant_id from channels where provider='evolution' and external_id=$1 limit 1`,
      [instanceName],
    )
    const tenantId = found.rows[0]?.tenant_id
    const config = tenantId ? (deps.config ?? evolutionConfig)(tenantId) : null
    if (!config || config.instanceName !== instanceName || !secureEqual(evolutionWebhookSecret(config), request.headers['x-avila-webhook-token'])) {
      return reply.code(401).send({ error: 'Webhook não autorizado.' })
    }
    const accepted = new Set(['messages.upsert', 'messages.update', 'send.message', 'connection.update'])
    if (!accepted.has(event)) return reply.code(202).send({ received: true })
    const client = createEvolutionClient(config, deps.fetch)
    const schedule = (delay: number) => {
      const timer = setTimeout(() => {
        void synchronize(config, client).catch((error) => {
          if (!(error instanceof EvolutionError) || error.status !== 409) app.log.info('Evolution: webhook recebido; reconciliação será repetida pelo fallback.')
        })
      }, delay)
      timer.unref()
    }
    schedule(250)
    schedule(2_500)
    await saveWebhookHealth(config, { state: 'connected', lastEventAt: new Date().toISOString(), lastEvent: event, error: null }).catch(() => {})
    return reply.code(202).send({ received: true })
  })

  if (deps.background === true && process.env.EVOLUTION_SYNC_ENABLED === 'true') {
    let running = false
    const webhookConfiguredAt = new Map<string, number>()
    const run = async () => {
      if (running) return
      running = true
      try {
        const channels = await db<{ tenant_id: string; external_id: string }>("select tenant_id,external_id from channels where provider='evolution' and status in ('connected','connecting','disconnected') and metadata->>'source'='evolution-api' order by last_sync_at nulls first")
        for (const channel of channels.rows) {
          const config = (deps.config ?? evolutionConfig)(channel.tenant_id)
          if (!config || config.instanceName !== channel.external_id) continue
          if (Date.now() - (webhookConfiguredAt.get(config.tenantId) ?? 0) >= 5 * 60_000) {
            await ensureWebhook(config, createEvolutionClient(config, deps.fetch))
            webhookConfiguredAt.set(config.tenantId, Date.now())
          }
          try { await synchronize(config, createEvolutionClient(config, deps.fetch)) } catch { app.log.info('Evolution: sincronização adiada; conexão indisponível.') }
        }
      } catch { app.log.info('Evolution: não foi possível consultar os canais para sincronizar.') }
      finally { running = false }
    }
    const timer = setInterval(run, 15_000)
    app.addHook('onReady', async () => { void run() })
    timer.unref()
    app.addHook('onClose', async () => { clearInterval(timer) })
  }
}
