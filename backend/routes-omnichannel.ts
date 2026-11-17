import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { query as databaseQuery } from './db.js'
import type { RealtimeEvent } from './realtime.js'
import {
  allowedWidgetOrigin,
  hashVisitorToken,
  parseMetaMessagingEvents,
  verifyMetaSignature,
  type MetaMessagingEvent,
} from './omnichannel.js'

type AuthUser = { id: string; tenant_id: string; name: string; email: string; role: string }
type Query = typeof databaseQuery
type RawBodyRequest = FastifyRequest & { rawBody?: Buffer }

type Dependencies = {
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthUser | null>
  canManage: (user: AuthUser) => boolean
  encryptSecret: (value: string | null) => string | null
  decryptSecret: (value: string | null) => string | null
  recordEvent: (tenantId: string, entityType: string, eventType: string, payload: Record<string, unknown>, actorUserId?: string | null, entityId?: string | null, requestId?: string | null) => Promise<void>
  publish: (event: RealtimeEvent) => void
  query?: Query
  fetch?: typeof fetch
}

type SocialChannel = { id: string; tenant_id: string; provider: 'instagram' | 'messenger'; external_id: string }
type MetaAccount = { id?: string; name?: string; instagram_business_account?: { id?: string; name?: string; username?: string } }

const metaConfigSchema = z.object({
  pageId: z.string().trim().min(2).max(100),
  pageName: z.string().trim().min(1).max(160),
  instagramId: z.string().trim().max(100).optional().default(''),
  instagramName: z.string().trim().max(160).optional().default(''),
  accessToken: z.string().trim().min(10).max(2000),
  appSecret: z.string().trim().min(8).max(500),
  verifyToken: z.string().trim().min(16).max(500),
})

const webchatConfigSchema = z.object({
  name: z.string().trim().min(1).max(160).default('Chat do site'),
  allowedOrigins: z.array(z.string().trim().max(300)).min(1).max(20),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#2563eb'),
  welcomeMessage: z.string().trim().max(500).default('Olá! Como podemos ajudar?'),
})

function parseSecrets(value: string | null) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    const result = z.object({ appSecret: z.string(), verifyToken: z.string() }).safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function resolveExternalConversation(
  query: Query,
  channel: SocialChannel | { id: string; tenant_id: string; provider: 'webchat'; external_id: string },
  externalId: string,
  displayName: string,
) {
  const existing = await query<{ contact_id: string }>(
    'select contact_id from channel_contacts where tenant_id = $1 and channel_id = $2 and external_id = $3',
    [channel.tenant_id, channel.id, externalId],
  )
  let contactId = existing.rows[0]?.contact_id
  if (!contactId) {
    const contact = await query<{ id: string }>(
      `insert into contacts (tenant_id, name, source)
       values ($1, $2, $3) returning id`,
      [channel.tenant_id, displayName, channel.provider],
    )
    contactId = contact.rows[0].id
    const link = await query<{ contact_id: string }>(
      `insert into channel_contacts (tenant_id, channel_id, contact_id, external_id, display_name)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, channel_id, external_id)
       do update set display_name = excluded.display_name, updated_at = now()
       returning contact_id`,
      [channel.tenant_id, channel.id, contactId, externalId, displayName],
    )
    contactId = link.rows[0].contact_id
  }

  const found = await query<{ id: string }>(
    `select id from conversations
      where tenant_id = $1 and channel_id = $2 and contact_id = $3 and status <> 'archived'
      order by updated_at desc limit 1`,
    [channel.tenant_id, channel.id, contactId],
  )
  if (found.rows[0]) return { contactId, conversationId: found.rows[0].id }
  const created = await query<{ id: string }>(
    `insert into conversations (tenant_id, channel_id, contact_id, status)
     values ($1, $2, $3, 'open') returning id`,
    [channel.tenant_id, channel.id, contactId],
  )
  return { contactId, conversationId: created.rows[0].id }
}

async function ingestExternalMessage(query: Query, channel: SocialChannel, event: MetaMessagingEvent) {
  const identity = await resolveExternalConversation(query, channel, event.senderExternalId, `${channel.provider === 'instagram' ? 'Instagram' : 'Messenger'} • ${event.senderExternalId.slice(-6)}`)
  const inserted = await query(
    `insert into messages (tenant_id, conversation_id, external_id, direction, sender_name, body, message_type, status, sent_at)
     values ($1, $2, $3, 'inbound', $4, $5, $6, 'received', $7)
     on conflict (tenant_id, external_id) do nothing
     returning id, conversation_id, external_id, direction, sender_name, body, message_type, status, sent_at, created_at`,
    [channel.tenant_id, identity.conversationId, event.externalId, channel.provider, event.body, event.messageType, event.sentAt],
  )
  if (!inserted.rows[0]) return null
  const conversation = await query(
    `update conversations set unread_count = unread_count + 1, last_message_at = $3,
       last_customer_message_at = $3, updated_at = now()
     where tenant_id = $1 and id = $2
     returning id, status, unread_count, last_message_at, last_customer_message_at, updated_at`,
    [channel.tenant_id, identity.conversationId, event.sentAt],
  )
  return { conversationId: identity.conversationId, conversation: conversation.rows[0], message: inserted.rows[0] }
}

async function verifyMetaAccount(fetcher: typeof fetch, input: z.infer<typeof metaConfigSchema>) {
  const response = await fetcher('https://graph.facebook.com/v23.0/me?fields=id,name,instagram_business_account{id,name,username}', {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const account = await response.json().catch(() => null) as (MetaAccount & { error?: { message?: string } }) | null
  if (!response.ok || !account?.id) throw new Error(account?.error?.message || 'A Meta não confirmou a conta informada.')
  if (account.id !== input.pageId) throw new Error('O token não pertence à Página informada.')
  if (input.instagramId && account.instagram_business_account?.id !== input.instagramId) {
    throw new Error('A conta do Instagram não pertence à Página informada.')
  }
  return account
}

async function readWidgetChannel(query: Query, widgetKey: string) {
  const result = await query<{
    id: string
    tenant_id: string
    external_id: string
    display_name: string
    status: string
    metadata: { allowedOrigins?: unknown; brandColor?: unknown; welcomeMessage?: unknown }
  }>(
    `select id, tenant_id, external_id, display_name, status, metadata
       from channels where provider = 'webchat' and external_id = $1 limit 2`,
    [widgetKey],
  )
  return result.rows.length === 1 && result.rows[0].status === 'connected' ? result.rows[0] : null
}

function widgetOrigins(channel: Awaited<ReturnType<typeof readWidgetChannel>>) {
  if (!channel || !Array.isArray(channel.metadata.allowedOrigins)) return []
  return channel.metadata.allowedOrigins.filter((item): item is string => typeof item === 'string')
}

function setWidgetCors(reply: FastifyReply, origin: string) {
  reply.header('Access-Control-Allow-Origin', origin)
  reply.header('Vary', 'Origin')
  reply.header('Access-Control-Allow-Headers', 'authorization, content-type')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

async function authenticateWidgetSession(query: Query, widgetKey: string, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const result = await query<{
    id: string
    tenant_id: string
    channel_id: string
    contact_id: string
    conversation_id: string
    origin: string
  }>(
    `select s.id, s.tenant_id, s.channel_id, s.contact_id, s.conversation_id, s.origin
       from webchat_sessions s join channels ch on ch.id = s.channel_id and ch.tenant_id = s.tenant_id
      where ch.provider = 'webchat' and ch.external_id = $1 and s.token_hash = $2
        and s.revoked_at is null and s.expires_at > now()`,
    [widgetKey, hashVisitorToken(token)],
  )
  return result.rows[0] ?? null
}

export function registerOmnichannelRoutes(app: FastifyInstance, deps: Dependencies) {
  const query = deps.query ?? databaseQuery
  const fetcher = deps.fetch ?? fetch
  const publicBaseUrl = (process.env.PUBLIC_APP_URL ?? process.env.CRM_BASE_URL ?? 'https://crm.avilaops.com').replace(/\/$/, '')

  app.get('/api/channels/meta-messaging', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    const integration = await query<{ connected_at: string | null; user_name: string | null; metadata: Record<string, unknown> }>(
      `select connected_at, user_name, metadata from integrations where tenant_id = $1 and provider = 'meta_messaging'`,
      [user.tenant_id],
    )
    const channels = await query(
      `select id, provider, external_id, display_name, status, error_message, updated_at
         from channels where tenant_id = $1 and provider in ('instagram', 'messenger') order by provider`,
      [user.tenant_id],
    )
    return { connected: Boolean(integration.rows[0]?.connected_at), account: integration.rows[0]?.user_name ?? null, channels: channels.rows }
  })

  app.put('/api/channels/meta-messaging', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    if (!deps.canManage(user)) return reply.code(403).send({ error: 'Permissão insuficiente.' })
    const input = metaConfigSchema.parse(request.body)
    let account: MetaAccount
    try {
      account = await verifyMetaAccount(fetcher, input)
    } catch (caught) {
      return reply.code(400).send({ error: caught instanceof Error ? caught.message : 'Credenciais inválidas.' })
    }
    const occupied = await query<{ tenant_id: string }>(
      `select tenant_id from channels where provider = 'messenger' and external_id = $1 and status = 'connected'
       union all select tenant_id from channels where provider = 'instagram' and external_id = $2 and status = 'connected'`,
      [input.pageId, input.instagramId || null],
    )
    if (occupied.rows.some((row) => row.tenant_id !== user.tenant_id)) {
      return reply.code(409).send({ error: 'Esta conta Meta já está vinculada a outra empresa.' })
    }
    const pageName = account.name?.trim() || input.pageName
    const instagramName = account.instagram_business_account?.username?.trim()
      || account.instagram_business_account?.name?.trim()
      || input.instagramName
    const encryptedSecrets = deps.encryptSecret(JSON.stringify({ appSecret: input.appSecret, verifyToken: input.verifyToken }))
    const encryptedToken = deps.encryptSecret(input.accessToken)
    await query(
      `insert into integrations (tenant_id, provider, app_id, app_secret, access_token, user_name, metadata, connected_at, updated_at)
       values ($1, 'meta_messaging', $2, $3, $4, $5, $6::jsonb, now(), now())
       on conflict (tenant_id, provider) do update set app_id = excluded.app_id, app_secret = excluded.app_secret,
         access_token = excluded.access_token, user_name = excluded.user_name, metadata = excluded.metadata,
         connected_at = now(), updated_at = now()`,
      [user.tenant_id, input.pageId, encryptedSecrets, encryptedToken, pageName, JSON.stringify({ instagramId: input.instagramId || null, instagramName: instagramName || null })],
    )
    await query(
      `insert into channels (tenant_id, provider, external_id, display_name, status, metadata, updated_at)
       values ($1, 'messenger', $2, $3, 'connected', '{}'::jsonb, now())
       on conflict (tenant_id, provider, external_id) do update set display_name = excluded.display_name, status = 'connected', error_message = null, updated_at = now()`,
      [user.tenant_id, input.pageId, pageName],
    )
    if (input.instagramId) {
      await query(
        `insert into channels (tenant_id, provider, external_id, display_name, status, metadata, updated_at)
         values ($1, 'instagram', $2, $3, 'connected', '{}'::jsonb, now())
         on conflict (tenant_id, provider, external_id) do update set display_name = excluded.display_name, status = 'connected', error_message = null, updated_at = now()`,
        [user.tenant_id, input.instagramId, instagramName || pageName],
      )
    }
    await query(
      `update channels set status = 'disconnected', updated_at = now()
        where tenant_id = $1 and provider in ('instagram', 'messenger')
          and ((provider = 'messenger' and external_id <> $2)
            or (provider = 'instagram' and ($3::text is null or external_id <> $3)))`,
      [user.tenant_id, input.pageId, input.instagramId || null],
    )
    await deps.recordEvent(user.tenant_id, 'integration', 'meta_messaging.connected', { page_id: input.pageId, instagram: Boolean(input.instagramId) }, user.id)
    return { connected: true }
  })

  app.delete('/api/channels/meta-messaging', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    if (!deps.canManage(user)) return reply.code(403).send({ error: 'Permissão insuficiente.' })
    await query("update integrations set app_secret = null, access_token = null, connected_at = null, updated_at = now() where tenant_id = $1 and provider = 'meta_messaging'", [user.tenant_id])
    await query("update channels set status = 'disconnected', updated_at = now() where tenant_id = $1 and provider in ('instagram', 'messenger')", [user.tenant_id])
    await deps.recordEvent(user.tenant_id, 'integration', 'meta_messaging.disconnected', {}, user.id)
    return { connected: false }
  })

  app.get('/webhooks/meta/messaging', async (request, reply) => {
    const params = z.object({ 'hub.mode': z.string().optional(), 'hub.verify_token': z.string().optional(), 'hub.challenge': z.string().optional() }).parse(request.query)
    if (params['hub.mode'] !== 'subscribe' || !params['hub.verify_token']) return reply.code(400).send('invalid')
    const integrations = await query<{ app_secret: string | null }>("select app_secret from integrations where provider = 'meta_messaging' and connected_at is not null")
    const valid = integrations.rows.some((row) => {
      const secrets = parseSecrets(deps.decryptSecret(row.app_secret))
      return Boolean(secrets && safeEqual(secrets.verifyToken, params['hub.verify_token'] ?? ''))
    })
    return valid ? reply.type('text/plain').send(params['hub.challenge'] ?? '') : reply.code(403).send('invalid')
  })

  app.post('/webhooks/meta/messaging', async (request, reply) => {
    const events = parseMetaMessagingEvents(request.body)
    if (events.length === 0) return { received: true, imported: 0 }
    const rawBody = (request as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(request.body))
    let imported = 0
    for (const event of events) {
      const channels = await query<SocialChannel>(
        `select id, tenant_id, provider, external_id from channels
          where provider in ('instagram', 'messenger') and external_id = $1 and status = 'connected' limit 2`,
        [event.channelExternalId],
      )
      if (channels.rows.length !== 1) return reply.code(400).send({ error: 'Canal desconhecido ou ambíguo.' })
      const channel = channels.rows[0]
      const integration = await query<{ app_secret: string | null }>("select app_secret from integrations where tenant_id = $1 and provider = 'meta_messaging'", [channel.tenant_id])
      const secrets = parseSecrets(deps.decryptSecret(integration.rows[0]?.app_secret ?? null))
      if (!secrets || !verifyMetaSignature(rawBody, request.headers['x-hub-signature-256'], secrets.appSecret)) return reply.code(401).send({ error: 'Assinatura inválida.' })
      const saved = await ingestExternalMessage(query, channel, event)
      if (saved) {
        imported += 1
        deps.publish({ type: 'conversation.updated', tenantId: channel.tenant_id, conversationId: saved.conversationId, data: saved.conversation })
        deps.publish({ type: 'message.created', tenantId: channel.tenant_id, conversationId: saved.conversationId, data: saved.message })
      }
    }
    return { received: true, imported }
  })

  app.get('/api/channels/webchat', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    const result = await query<{ external_id: string; display_name: string; status: string; metadata: Record<string, unknown> }>(
      "select external_id, display_name, status, metadata from channels where tenant_id = $1 and provider = 'webchat' order by created_at desc limit 1",
      [user.tenant_id],
    )
    const channel = result.rows[0] ?? null
    return { channel, embedCode: channel ? `<script async src="${publicBaseUrl}/api/public/chat/widget.js?key=${channel.external_id}"></script>` : null }
  })

  app.put('/api/channels/webchat', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    if (!deps.canManage(user)) return reply.code(403).send({ error: 'Permissão insuficiente.' })
    const input = webchatConfigSchema.parse(request.body)
    for (const origin of input.allowedOrigins) if (origin !== '*' && !/^https?:\/\//.test(origin)) return reply.code(400).send({ error: 'Origem inválida.' })
    const current = await query<{ external_id: string }>("select external_id from channels where tenant_id = $1 and provider = 'webchat' order by created_at desc limit 1", [user.tenant_id])
    const widgetKey = current.rows[0]?.external_id ?? randomUUID()
    const metadata = { allowedOrigins: input.allowedOrigins, brandColor: input.brandColor, welcomeMessage: input.welcomeMessage }
    await query(
      `insert into channels (tenant_id, provider, external_id, display_name, status, metadata, updated_at)
       values ($1, 'webchat', $2, $3, 'connected', $4::jsonb, now())
       on conflict (tenant_id, provider, external_id) do update set display_name = excluded.display_name,
         status = 'connected', metadata = excluded.metadata, error_message = null, updated_at = now()`,
      [user.tenant_id, widgetKey, input.name, JSON.stringify(metadata)],
    )
    await deps.recordEvent(user.tenant_id, 'channel', 'webchat.configured', { allowed_origins: input.allowedOrigins.length }, user.id)
    return { channel: { external_id: widgetKey, display_name: input.name, status: 'connected', metadata }, embedCode: `<script async src="${publicBaseUrl}/api/public/chat/widget.js?key=${widgetKey}"></script>` }
  })

  app.options('/api/public/chat/:widgetKey/:action', async (request, reply) => {
    const { widgetKey } = z.object({ widgetKey: z.string().uuid() }).parse(request.params)
    const channel = await readWidgetChannel(query, widgetKey)
    const origin = request.headers.origin
    if (!channel || !allowedWidgetOrigin(origin, widgetOrigins(channel))) return reply.code(403).send()
    setWidgetCors(reply, origin!)
    return reply.code(204).send()
  })

  app.post('/api/public/chat/:widgetKey/session', async (request, reply) => {
    const { widgetKey } = z.object({ widgetKey: z.string().uuid() }).parse(request.params)
    const channel = await readWidgetChannel(query, widgetKey)
    const origin = request.headers.origin
    if (!channel || !allowedWidgetOrigin(origin, widgetOrigins(channel))) return reply.code(403).send({ error: 'Origem não autorizada.' })
    setWidgetCors(reply, origin!)
    const input = z.object({ name: z.string().trim().max(120).default('Visitante'), email: z.string().trim().email().max(254).optional() }).parse(request.body ?? {})
    const token = randomBytes(32).toString('base64url')
    const sessionId = randomUUID()
    const contact = await query<{ id: string }>(
      `insert into contacts (tenant_id, name, email, source) values ($1, $2, $3, 'webchat') returning id`,
      [channel.tenant_id, input.name || 'Visitante', input.email ?? null],
    )
    const conversation = await query<{ id: string }>(
      `insert into conversations (tenant_id, channel_id, contact_id, status) values ($1, $2, $3, 'open') returning id`,
      [channel.tenant_id, channel.id, contact.rows[0].id],
    )
    await query(
      `insert into channel_contacts (tenant_id, channel_id, contact_id, external_id, display_name)
       values ($1, $2, $3, $4, $5)`,
      [channel.tenant_id, channel.id, contact.rows[0].id, sessionId, input.name || 'Visitante'],
    )
    await query(
      `insert into webchat_sessions (id, tenant_id, channel_id, contact_id, conversation_id, token_hash, visitor_name, visitor_email, origin)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [sessionId, channel.tenant_id, channel.id, contact.rows[0].id, conversation.rows[0].id, hashVisitorToken(token), input.name || 'Visitante', input.email ?? null, origin],
    )
    return reply.code(201).send({ token, sessionId, welcomeMessage: typeof channel.metadata.welcomeMessage === 'string' ? channel.metadata.welcomeMessage : 'Olá! Como podemos ajudar?' })
  })

  app.get('/api/public/chat/:widgetKey/messages', async (request, reply) => {
    const { widgetKey } = z.object({ widgetKey: z.string().uuid() }).parse(request.params)
    const origin = request.headers.origin
    const channel = await readWidgetChannel(query, widgetKey)
    if (!channel || !allowedWidgetOrigin(origin, widgetOrigins(channel))) return reply.code(403).send({ error: 'Origem não autorizada.' })
    setWidgetCors(reply, origin!)
    const session = await authenticateWidgetSession(query, widgetKey, request.headers.authorization)
    if (!session || session.origin !== origin) return reply.code(401).send({ error: 'Sessão inválida.' })
    const { after } = z.object({ after: z.string().datetime().optional() }).parse(request.query)
    const result = await query(
      `select id, direction, body, message_type, status, sent_at from messages
        where tenant_id = $1 and conversation_id = $2 and ($3::timestamptz is null or sent_at > $3)
        order by sent_at asc limit 200`,
      [session.tenant_id, session.conversation_id, after ?? null],
    )
    await query('update webchat_sessions set last_seen_at = now() where tenant_id = $1 and id = $2', [session.tenant_id, session.id])
    return { messages: result.rows }
  })

  app.post('/api/public/chat/:widgetKey/messages', async (request, reply) => {
    const { widgetKey } = z.object({ widgetKey: z.string().uuid() }).parse(request.params)
    const origin = request.headers.origin
    const channel = await readWidgetChannel(query, widgetKey)
    if (!channel || !allowedWidgetOrigin(origin, widgetOrigins(channel))) return reply.code(403).send({ error: 'Origem não autorizada.' })
    setWidgetCors(reply, origin!)
    const session = await authenticateWidgetSession(query, widgetKey, request.headers.authorization)
    if (!session || session.origin !== origin) return reply.code(401).send({ error: 'Sessão inválida.' })
    const input = z.object({ body: z.string().trim().min(1).max(4000), idempotencyKey: z.string().uuid() }).parse(request.body)
    const saved = await query(
      `insert into messages (tenant_id, conversation_id, external_id, direction, sender_name, body, message_type, status, idempotency_key, sent_at)
       values ($1, $2, $3, 'inbound', 'Visitante', $4, 'text', 'received', $3, now())
       on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
       returning id, conversation_id, direction, sender_name, body, message_type, status, sent_at, created_at`,
      [session.tenant_id, session.conversation_id, input.idempotencyKey, input.body],
    )
    if (!saved.rows[0]) return { accepted: true, idempotent: true }
    const conversation = await query(
      `update conversations set unread_count = unread_count + 1, last_message_at = now(),
         last_customer_message_at = now(), updated_at = now() where tenant_id = $1 and id = $2
         returning id, status, unread_count, last_message_at, last_customer_message_at, updated_at`,
      [session.tenant_id, session.conversation_id],
    )
    deps.publish({ type: 'conversation.updated', tenantId: session.tenant_id, conversationId: session.conversation_id, data: conversation.rows[0] })
    deps.publish({ type: 'message.created', tenantId: session.tenant_id, conversationId: session.conversation_id, data: saved.rows[0] })
    return reply.code(201).send({ accepted: true, message: saved.rows[0] })
  })

  app.get('/api/public/chat/widget.js', async (request, reply) => {
    const { key } = z.object({ key: z.string().uuid() }).parse(request.query)
    const channel = await readWidgetChannel(query, key)
    if (!channel) return reply.code(404).send('')
    const color = typeof channel.metadata.brandColor === 'string' ? channel.metadata.brandColor : '#2563eb'
    const script = widgetScript(publicBaseUrl, key, color)
    return reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=300').send(script)
  })

  async function sendMetaText(tenantId: string, channelExternalId: string, recipientId: string, body: string) {
    const integration = await query<{ access_token: string | null }>("select access_token from integrations where tenant_id = $1 and provider = 'meta_messaging' and connected_at is not null", [tenantId])
    const token = deps.decryptSecret(integration.rows[0]?.access_token ?? null)
    if (!token) throw new Error('Meta Messaging não conectada.')
    const response = await fetcher(`https://graph.facebook.com/v23.0/${channelExternalId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: body } }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await response.json() as { message_id?: string; error?: { message?: string } }
    if (!response.ok || !data.message_id) throw new Error(data.error?.message || 'A Meta não confirmou o envio.')
    return data.message_id
  }

  return { sendMetaText }
}

function widgetScript(base: string, key: string, color: string) {
  return `(()=>{if(window.__avilaCrmChat)return;window.__avilaCrmChat=1;const api=${JSON.stringify(base)},key=${JSON.stringify(key)},color=${JSON.stringify(color)};const host=document.createElement('div');host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,sans-serif';const root=host.attachShadow({mode:'open'});root.innerHTML='<style>button{font:inherit}.open{width:56px;height:56px;border:0;border-radius:50%;background:'+color+';color:white;font-size:24px;cursor:pointer}.panel{display:none;width:min(360px,calc(100vw - 32px));height:520px;max-height:calc(100vh - 100px);background:white;border:1px solid #dbe2ea;border-radius:16px;box-shadow:0 18px 60px #0f172a33;overflow:hidden}.head{padding:14px 16px;background:'+color+';color:white;font-weight:700}.messages{height:340px;overflow:auto;padding:12px;background:#f8fafc}.msg{margin:8px 0;padding:9px 11px;border-radius:12px;background:white;color:#0f172a}.mine{background:'+color+';color:white;margin-left:34px}.form{display:flex;gap:8px;padding:10px}.form input{min-width:0;flex:1;padding:10px;border:1px solid #cbd5e1;border-radius:9px}.form button{border:0;border-radius:9px;background:'+color+';color:white;padding:0 14px}.intro{padding:16px}.intro input{box-sizing:border-box;width:100%;margin:5px 0;padding:10px;border:1px solid #cbd5e1;border-radius:9px}.intro button{width:100%;margin-top:8px;padding:10px;border:0;border-radius:9px;background:'+color+';color:white}</style><button class="open" aria-label="Abrir atendimento">💬</button><section class="panel" aria-label="Chat de atendimento"><div class="head">Atendimento</div><div class="intro"><input name="name" placeholder="Seu nome"><input name="email" type="email" placeholder="Seu e-mail • opcional"><button>Começar conversa</button></div><div class="messages" hidden></div><form class="form" hidden><input aria-label="Mensagem" maxlength="4000" placeholder="Digite sua mensagem"><button>Enviar</button></form></section>';const open=root.querySelector('.open'),panel=root.querySelector('.panel'),intro=root.querySelector('.intro'),messages=root.querySelector('.messages'),form=root.querySelector('.form'),seen=new Set;let token='',after='';open.onclick=()=>{panel.style.display=panel.style.display==='block'?'none':'block'};const headers=()=>({'content-type':'application/json',authorization:'Bearer '+token});function add(body,mine,id){if(id&&seen.has(id))return;if(id)seen.add(id);const el=document.createElement('div');el.className='msg'+(mine?' mine':'');el.textContent=body;messages.append(el);messages.scrollTop=messages.scrollHeight}async function poll(){if(!token)return;const r=await fetch(api+'/api/public/chat/'+key+'/messages'+(after?'?after='+encodeURIComponent(after):''),{headers:headers()});if(r.ok){const data=await r.json();for(const item of data.messages){add(item.body,item.direction==='inbound',item.id);after=item.sent_at}}setTimeout(poll,3000)}intro.querySelector('button').onclick=async()=>{const name=intro.querySelector('[name=name]').value||'Visitante',email=intro.querySelector('[name=email]').value||undefined;const r=await fetch(api+'/api/public/chat/'+key+'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,email})});if(!r.ok)return;const data=await r.json();token=data.token;intro.hidden=true;messages.hidden=false;form.hidden=false;add(data.welcomeMessage,false);poll()};form.onsubmit=async e=>{e.preventDefault();const input=form.querySelector('input'),body=input.value.trim();if(!body)return;input.value='';const r=await fetch(api+'/api/public/chat/'+key+'/messages',{method:'POST',headers:headers(),body:JSON.stringify({body,idempotencyKey:crypto.randomUUID()})});if(r.ok){const data=await r.json();if(data.message)add(data.message.body,true,data.message.id)}};document.body.append(host)})();`
}

export type OmnichannelSender = ReturnType<typeof registerOmnichannelRoutes>['sendMetaText']
