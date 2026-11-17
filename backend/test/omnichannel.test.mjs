import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import Fastify from 'fastify'
import {
  allowedWidgetOrigin,
  hashVisitorToken,
  parseMetaMessagingEvents,
  verifyMetaSignature,
} from '../../dist-server/omnichannel.js'
import { registerOmnichannelRoutes } from '../../dist-server/routes-omnichannel.js'

test('normaliza eventos do Messenger e Instagram sem aceitar eventos vazios', () => {
  const payload = {
    object: 'page',
    entry: [{
      id: 'page-1',
      messaging: [
        { sender: { id: 'person-1' }, recipient: { id: 'page-1' }, timestamp: 1_700_000_000_000, message: { mid: 'm-1', text: 'Olá' } },
        { sender: { id: 'page-1' }, recipient: { id: 'person-1' }, timestamp: 1_700_000_001_000, message: { mid: 'm-own', text: 'Resposta da página', is_echo: true } },
        { sender: { id: 'person-2' }, recipient: { id: 'page-1' }, message: { mid: 'm-empty' } },
      ],
    }],
  }

  assert.deepEqual(parseMetaMessagingEvents(payload), [{
    channelExternalId: 'page-1',
    senderExternalId: 'person-1',
    externalId: 'm-1',
    body: 'Olá',
    messageType: 'text',
    sentAt: '2023-11-14T22:13:20.000Z',
  }])

  const instagram = structuredClone(payload)
  instagram.object = 'instagram'
  instagram.entry[0].id = 'ig-1'
  instagram.entry[0].messaging = [{ sender: { id: 'person-ig' }, recipient: { id: 'ig-1' }, message: { mid: 'ig-m-1', attachments: [{ type: 'image' }] } }]
  assert.equal(parseMetaMessagingEvents(instagram)[0].messageType, 'image')
  assert.equal(parseMetaMessagingEvents(instagram)[0].body, '[image]')
})

test('assinatura Meta usa o corpo bruto e comparação segura', () => {
  const raw = Buffer.from('{"entry":[]}')
  const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`
  assert.equal(verifyMetaSignature(raw, signature, 'secret'), true)
  assert.equal(verifyMetaSignature(Buffer.from('{}'), signature, 'secret'), false)
  assert.equal(verifyMetaSignature(raw, 'sha256=curta', 'secret'), false)
})

test('chat do site aceita somente origens exatas configuradas e guarda hash do token', () => {
  assert.equal(allowedWidgetOrigin('https://loja.example', ['https://loja.example']), true)
  assert.equal(allowedWidgetOrigin('https://evil.example', ['https://loja.example']), false)
  assert.equal(allowedWidgetOrigin(undefined, ['https://loja.example']), false)
  assert.equal(allowedWidgetOrigin('https://qualquer.example', ['*']), true)
  assert.match(hashVisitorToken('token-secreto'), /^[a-f0-9]{64}$/)
  assert.notEqual(hashVisitorToken('token-secreto'), 'token-secreto')
})

test('configuração social exige gestão e nunca devolve credenciais', async (t) => {
  const calls = []
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => ({ id: 'user-a', tenant_id: 'tenant-a', name: 'A', email: 'a@example.test', role: 'admin' }),
    canManage: () => true,
    encryptSecret: (value) => value ? `enc(${value})` : null,
    decryptSecret: (value) => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => 'a@example.test',
    getMetaConnection: async () => ({ conta: { id: 'a', email: 'a@example.test' }, meta: { usuarioId: 'meta-a', nome: 'Conta A', escopos: ['pages_messaging', 'pages_manage_metadata', 'instagram_manage_messages'], expiraEm: null }, token: 'user-token', ativos: [
      { tipo: 'pagina', externoId: 'page-1', nome: 'Página verificada', detalhe: {}, token: 'page-token-secret' },
      { tipo: 'instagram', externoId: 'ig-1', nome: '@pagina', detalhe: { paginaId: 'page-1' }, token: null },
    ] }),
    fetch: async (url, init) => {
      assert.equal(init.method, 'POST')
      assert.match(String(url), /page-1\/subscribed_apps/)
      assert.doesNotMatch(String(url), /page-token-secret/)
      assert.equal(init.body.get('subscribed_fields'), 'messages,messaging_postbacks')
      assert.equal(init.body.get('access_token'), 'page-token-secret')
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    },
    query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 } },
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/channels/meta-messaging/oauth/sync', payload: { pageId: 'page-1' } })
  assert.equal(response.statusCode, 200, response.body)
  assert.doesNotMatch(response.body, /page-token-secret|user-token/)
  const serialized = JSON.stringify(calls)
  assert.match(serialized, /enc\(/)
  assert.doesNotMatch(serialized, /"page-token-secret"(?!\))/)
  assert.ok(calls.every((call) => !call.params.includes('tenant-b')))
})

test('configuração social exige que a conta SSO seja a conta do usuário', async (t) => {
  const writes = []
  let readConnection = false
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => ({ id: 'user-a', tenant_id: 'tenant-a', name: 'A', email: 'a@example.test', role: 'admin' }),
    canManage: () => true,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => 'outra@example.test',
    getMetaConnection: async () => { readConnection = true; throw new Error('não deveria consultar') },
    metaConnectUrl: () => 'https://auth.example.test/conta/meta',
    query: async (sql, params = []) => { writes.push({ sql, params }); return { rows: [], rowCount: 0 } },
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/channels/meta-messaging/oauth/sync', payload: { pageId: 'page-1' } })
  assert.equal(response.statusCode, 409, response.body)
  assert.equal(readConnection, false)
  assert.equal(writes.length, 0)
})

test('configuração social não toma um canal ativo de outra empresa', async (t) => {
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => ({ id: 'user-a', tenant_id: 'tenant-a', name: 'A', email: 'a@example.test', role: 'admin' }),
    canManage: () => true,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => 'a@example.test',
    getMetaConnection: async () => ({ conta: { id: 'a', email: 'a@example.test' }, meta: { usuarioId: 'meta-a', nome: 'Conta A', escopos: ['pages_messaging', 'pages_manage_metadata'], expiraEm: null }, token: 'user-token', ativos: [{ tipo: 'pagina', externoId: 'page-1', nome: 'Página', detalhe: {}, token: 'page-token' }] }),
    query: async sql => sql.includes('union all') ? { rows: [{ tenant_id: 'tenant-b' }], rowCount: 1 } : { rows: [], rowCount: 0 },
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/channels/meta-messaging/oauth/sync', payload: { pageId: 'page-1' } })
  assert.equal(response.statusCode, 409, response.body)
})

test('configuração social não persiste o canal quando a Meta rejeita a inscrição do webhook', async (t) => {
  const writes = []
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => ({ id: 'user-a', tenant_id: 'tenant-a', name: 'A', email: 'a@example.test', role: 'admin' }),
    canManage: () => true,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => 'a@example.test',
    getMetaConnection: async () => ({ conta: { id: 'a', email: 'a@example.test' }, meta: { usuarioId: 'meta-a', nome: 'Conta A', escopos: ['pages_messaging', 'pages_manage_metadata'], expiraEm: null }, token: 'user-token', ativos: [{ tipo: 'pagina', externoId: 'page-1', nome: 'Página', detalhe: {}, token: 'page-token' }] }),
    fetch: async () => new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 }),
    query: async (sql, params = []) => { writes.push({ sql, params }); return { rows: [], rowCount: 0 } },
  })
  t.after(() => app.close())

  const response = await app.inject({ method: 'POST', url: '/api/channels/meta-messaging/oauth/sync', payload: { pageId: 'page-1' } })
  assert.equal(response.statusCode, 502, response.body)
  assert.equal(writes.some((call) => /insert into (integrations|channels)/.test(call.sql)), false)
})

test('sessão pública do chat respeita origem e persiste somente hash do token', async (t) => {
  const calls = []
  const channel = { id: 'channel-a', tenant_id: 'tenant-a', external_id: '11111111-1111-4111-8111-111111111111', display_name: 'Site', status: 'connected', metadata: { allowedOrigins: ['https://site.example'], welcomeMessage: 'Olá' } }
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => null,
    canManage: () => false,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => null,
    query: async (sql, params = []) => {
      calls.push({ sql, params })
      if (sql.includes("provider = 'webchat'")) return { rows: [channel], rowCount: 1 }
      if (sql.includes('insert into contacts')) return { rows: [{ id: 'contact-a' }], rowCount: 1 }
      if (sql.includes('insert into conversations')) return { rows: [{ id: 'conversation-a' }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
  })
  t.after(() => app.close())

  const url = `/api/public/chat/${channel.external_id}/session`
  assert.equal((await app.inject({ method: 'POST', url, headers: { origin: 'https://evil.example' }, payload: { name: 'Evil' } })).statusCode, 403)
  const preflight = await app.inject({ method: 'OPTIONS', url, headers: { origin: 'https://site.example' } })
  assert.equal(preflight.statusCode, 204, preflight.body)
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://site.example')
  const writesBefore = calls.filter((call) => call.sql.includes('insert into contacts')).length
  const response = await app.inject({ method: 'POST', url, headers: { origin: 'https://site.example' }, payload: { name: 'Ana', email: 'ana@example.test' } })
  assert.equal(response.statusCode, 201, response.body)
  assert.equal(response.headers['access-control-allow-origin'], 'https://site.example')
  const token = response.json().token
  const sessionWrite = calls.find((call) => call.sql.includes('insert into webchat_sessions'))
  assert.equal(calls.filter((call) => call.sql.includes('insert into contacts')).length, writesBefore + 1)
  assert.equal(sessionWrite.params[5], hashVisitorToken(token))
  assert.notEqual(sessionWrite.params[5], token)
})

test('widget usa a origem pública HTTPS e não duplica mensagens persistidas', async (t) => {
  const previous = process.env.PUBLIC_APP_URL
  process.env.PUBLIC_APP_URL = 'https://crm.example.test'
  const channel = { id: 'channel-a', tenant_id: 'tenant-a', external_id: '11111111-1111-4111-8111-111111111111', display_name: 'Site', status: 'connected', metadata: { allowedOrigins: ['https://site.example'] } }
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => null,
    canManage: () => false,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: () => {},
    emailDoSso: async () => null,
    query: async () => ({ rows: [channel], rowCount: 1 }),
  })
  t.after(() => {
    if (previous === undefined) delete process.env.PUBLIC_APP_URL
    else process.env.PUBLIC_APP_URL = previous
    return app.close()
  })

  const response = await app.inject({ method: 'GET', url: `/api/public/chat/widget.js?key=${channel.external_id}` })
  assert.equal(response.statusCode, 200, response.body)
  assert.match(response.body, /https:\/\/crm\.example\.test/)
  assert.match(response.body, /seen=new Set/)
  assert.doesNotMatch(response.body, /request\.protocol/)
})

test('mensagem do chat publica a entrada e depois reconcilia o estado persistido', async (t) => {
  const events = []
  const channel = { id: 'channel-a', tenant_id: 'tenant-a', external_id: '11111111-1111-4111-8111-111111111111', display_name: 'Site', status: 'connected', metadata: { allowedOrigins: ['https://site.example'] } }
  const app = Fastify()
  registerOmnichannelRoutes(app, {
    requireAuth: async () => null,
    canManage: () => false,
    encryptSecret: value => value,
    decryptSecret: value => value,
    recordEvent: async () => {},
    publish: event => events.push(event),
    emailDoSso: async () => null,
    query: async (sql) => {
      if (sql.includes("from channels where provider = 'webchat'")) return { rows: [channel], rowCount: 1 }
      if (sql.includes('from webchat_sessions')) return { rows: [{ id: 'session-a', tenant_id: 'tenant-a', channel_id: 'channel-a', contact_id: 'contact-a', conversation_id: 'conversation-a', origin: 'https://site.example' }], rowCount: 1 }
      if (sql.includes('insert into messages')) return { rows: [{ id: 'message-a', conversation_id: 'conversation-a', body: 'Olá', direction: 'inbound', sent_at: new Date().toISOString() }], rowCount: 1 }
      if (sql.includes('update conversations')) {
        assert.match(sql, /status = 'waiting'/)
        return { rows: [{ id: 'conversation-a', status: 'waiting', unread_count: 1 }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'POST',
    url: `/api/public/chat/${channel.external_id}/messages`,
    headers: { origin: 'https://site.example', authorization: 'Bearer visitor-token' },
    payload: { body: 'Olá', idempotencyKey: '22222222-2222-4222-8222-222222222222' },
  })
  assert.equal(response.statusCode, 201, response.body)
  assert.deepEqual(events.map(event => event.type), ['message.created', 'conversation.updated'])
})
