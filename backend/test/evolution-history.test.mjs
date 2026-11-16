import assert from 'node:assert/strict'
import test from 'node:test'
import { evolutionMessage } from '../../dist-server/evolution-history.js'
import { createEvolutionClient } from '../../dist-server/evolution.js'
import { registerEvolutionRoutes } from '../../dist-server/evolution.js'
import Fastify from 'fastify'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('histórico mantém grupos, LID e mídia sem legenda sem inventar telefone', () => {
  const base = { key: { id: 'a', remoteJid: '123456789012@g.us' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { imageMessage: { mimetype: 'image/jpeg' } } }
  const group = evolutionMessage(base)
  assert.equal(group.address, '123456789012@g.us')
  assert.equal(group.type, 'image')
  assert.match(group.text, /Imagem/)
  assert.equal(evolutionMessage({ ...base, key: { ...base.key, remoteJid: '999999999999@lid' } }).address, '999999999999@lid')
  assert.equal(evolutionMessage({ ...base, key: { ...base.key, remoteJid: 'status@broadcast' } }), null)
  assert.equal(evolutionMessage({ ...base, message: { protocolMessage: {} } }), null)
})

test('consulta solicita a página completa indicada e preserva metadados de paginação', async () => {
  const client = createEvolutionClient({ baseUrl: 'https://example.com', apiKey: 'test', tenantId: 'test', instanceName: 'test' }, async (_, init) => {
    assert.deepEqual(JSON.parse(init.body), { where: {}, page: 7, offset: 100 })
    return Response.json({ messages: { records: [{ key: { id: 'last' } }], total: 601, pages: 7, currentPage: 7 } })
  })
  const page = await client.messages(7)
  assert.equal(page.total, 601)
  assert.equal(page.hasMore, false)
  assert.equal(page.records[0].key.id, 'last')
})

test('destinatários de grupos e LID são preservados no envio', async () => {
  const client = createEvolutionClient({ baseUrl: 'https://example.com', apiKey: 'test', tenantId: 'test', instanceName: 'test' }, async (_, init) => {
    assert.equal(JSON.parse(init.body).number, '123456789012@g.us')
    return Response.json({ key: { id: 'sent' } })
  })
  await client.sendText('123456789012@g.us', 'Oi')
})

test('importa mais de 100 mensagens, retoma após falha e repete o histórico sem duplicar', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const config = { baseUrl: 'https://example.com', apiKey: 'test', tenantId, instanceName: 'test' }
  const seen = new Set()
  const requested = []
  let progress
  let fail = true
  const app = Fastify()
  registerEvolutionRoutes(app, {
    config: () => config, requireAuth: async () => ({ tenant_id: tenantId, role: 'admin' }), canManage: () => true,
    upsertContact: async () => 'contact', conversation: async () => 'conversation',
    query: async (sql, params) => {
      assert.equal(params[0], tenantId)
      if (sql.startsWith('select metadata')) return { rows: [{ metadata: { evolutionSync: progress } }] }
      if (sql.startsWith('update channels set metadata')) { progress = JSON.parse(params[2]); return { rows: [] } }
      if (sql.startsWith('select id from messages')) return { rows: seen.has(params[1]) ? [{ id: params[1] }] : [] }
      if (sql.includes('insert into messages')) { seen.add(params[2]); return { rows: [{ id: params[2] }] } }
      return { rows: [{ id: 'channel' }] }
    },
    fetch: async (url, init) => {
      if (url.includes('connectionState')) return Response.json({ instance: { state: 'open' } })
      if (url.includes('fetchInstances')) return Response.json([{ name: 'test' }])
      const page = JSON.parse(init.body).page
      requested.push(page)
      if (page === 3 && fail) return Response.json({}, { status: 503 })
      const records = Array.from({ length: page === 7 ? 1 : 100 }, (_, i) => ({ key: { id: `${page}-${i}`, remoteJid: '5511999999999@s.whatsapp.net' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'test' } }))
      return Response.json({ messages: { records, total: 601, pages: 7 } })
    },
  })
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/integrations/evolution/sync' })).statusCode, 502)
    assert.equal(seen.size, 200)
    assert.equal(progress.historyPage, 3)
    assert.equal(progress.state, 'error')
    fail = false
    const next = await app.inject({ method: 'POST', url: '/api/integrations/evolution/sync' })
    assert.equal(next.statusCode, 200, next.body)
    assert.equal(progress.historyPage, 7)
    assert.equal(seen.size, 600)
    await app.inject({ method: 'POST', url: '/api/integrations/evolution/sync' })
    assert.equal(progress.historyComplete, true)
    assert.equal(seen.size, 601)
    assert.equal(progress.imported, 601)
    await app.inject({ method: 'POST', url: '/api/integrations/evolution/sync' })
    assert.equal(seen.size, 601)
    assert.equal(progress.imported, 601)
    assert.ok(requested.includes(7))
  } finally { await app.close() }
})

test('mídia com falha é recuperada automaticamente após espera sem duplicar a mensagem', async () => {
  const previous = process.env.MEDIA_DIR
  const directory = await mkdtemp(join(tmpdir(), 'crm-evolution-retry-'))
  process.env.MEDIA_DIR = directory
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const config = { baseUrl: 'https://example.com', apiKey: 'test', tenantId, instanceName: 'test' }
  const item = { key: { id: 'media-1', remoteJid: '5511999999999@s.whatsapp.net' }, messageTimestamp: Math.floor(Date.now() / 1000), message: { imageMessage: { mimetype: 'image/png' } } }
  let messageCount = 0
  let mediaStatus
  let attemptedAt = 0
  let downloads = 0
  let storedPath
  const events = []
  const app = Fastify()
  registerEvolutionRoutes(app, {
    config: () => config, requireAuth: async () => ({ tenant_id: tenantId, role: 'admin' }), canManage: () => true,
    upsertContact: async () => 'contact', conversation: async () => 'conversation', publish: event => events.push(event),
    query: async (sql, params) => {
      assert.equal(params[0], tenantId)
      if (sql.startsWith('select metadata')) return { rows: [{}] }
      if (sql.startsWith('select id from messages')) return { rows: messageCount ? [{ id: 'message' }] : [] }
      if (sql.includes('insert into messages')) { messageCount++; return { rows: [{ id: 'message' }] } }
      if (sql.includes('insert into message_media')) { mediaStatus = params[10]; attemptedAt = Date.now(); return { rows: [{ id: 'media' }] } }
      if (sql.startsWith('update message_media as media')) {
        assert.match(sql, /interval '1 minute'/)
        if (mediaStatus !== 'failed' || attemptedAt > Date.now() - 60_000) return { rows: [] }
        attemptedAt = Date.now()
        return { rows: [{ id: 'media', message_id: 'message', conversation_id: 'conversation', mime_type: 'image/png', file_name: null }] }
      }
      if (sql.startsWith('update message_media set file_size')) { mediaStatus = 'ready'; storedPath = params[3] }
      return { rows: [{ id: 'channel' }] }
    },
    fetch: async url => {
      if (url.includes('connectionState')) return Response.json({ instance: { state: 'open' } })
      if (url.includes('fetchInstances')) return Response.json([{ name: 'test' }])
      if (url.includes('getBase64FromMediaMessage')) {
        downloads++
        return downloads === 1 ? Response.json({}, { status: 503 }) : Response.json({ base64: Buffer.from('provider bytes').toString('base64') })
      }
      return Response.json({ messages: { records: [item], total: 1, pages: 1 } })
    },
  })
  try {
    const sync = () => app.inject({ method: 'POST', url: '/api/integrations/evolution/sync' })
    assert.equal((await sync()).statusCode, 200)
    assert.equal(mediaStatus, 'failed')
    assert.equal(downloads, 1)
    await sync()
    assert.equal(downloads, 1)
    attemptedAt = Date.now() - 61_000
    assert.equal((await sync()).json().imported, 0)
    assert.equal(mediaStatus, 'ready')
    assert.equal(downloads, 2)
    assert.equal(messageCount, 1)
    assert.equal(events.filter(event => event.type === 'message.updated').length, 1)
    assert.equal(await readFile(join(directory, storedPath), 'utf8'), 'provider bytes')
    await sync()
    assert.equal(downloads, 2)
  } finally {
    await app.close()
    if (previous === undefined) delete process.env.MEDIA_DIR
    else process.env.MEDIA_DIR = previous
    await rm(directory, { recursive: true, force: true })
  }
})
