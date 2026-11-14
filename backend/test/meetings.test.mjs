import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { before, after, test } from 'node:test'
import Fastify from 'fastify'
import { createServer } from 'node:http'
const enabled = Boolean(process.env.CRM_MEETINGS_TEST_DATABASE_URL)
let app, db, tenant, other, host, stranger, lead, meeting, invitation
let onCreate
const requests = []
const call = (method, url, payload, who = 'host', headers = {}) => app.inject({ method, url, payload, headers: { ...(who === 'none' ? {} : { 'x-test-user': who }), ...headers } })
before(async () => {
  if (!enabled) return
  process.env.DATABASE_URL = process.env.CRM_MEETINGS_TEST_DATABASE_URL
  db = await import('../../dist-server/db.js')
  await db.query(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'))
  tenant = randomUUID(); other = randomUUID(); host = randomUUID(); stranger = randomUUID(); lead = randomUUID()
  await db.query('insert into tenants(id,name,slug) values($1::uuid,$1::text,$1::text),($2::uuid,$2::text,$2::text)', [tenant, other])
  await db.query("insert into users(id,tenant_id,name,email,role) values($1,$2,'Host','host@test','atendente'),($3,$4,'Other','other@test','admin')", [host, tenant, stranger, other])
  await db.query("insert into leads(id,tenant_id,title) values($1,$2,'Lead de teste')", [lead, tenant])
  app = Fastify()
  const { installErrorHandler } = await import('../../dist-server/tenant-access.js')
  installErrorHandler(app)
  const { registerMeetingRoutes } = await import('../../dist-server/meetings.js')
  registerMeetingRoutes(app, {
    requireAuth: async (request, reply) => {
      if (!request.headers['x-test-user']) { reply.code(401).send({ error: 'Sessão necessária.' }); return null }
      return request.headers['x-test-user'] === 'host' ? { id: host, tenant_id: tenant, name: 'Host', role: 'atendente' } : { id: stranger, tenant_id: other, name: 'Other', role: 'admin' }
    }, decryptSecret: s => s, background: false,
    config: () => ({ url: 'ws://127.0.0.1:7880', apiKey: 'key', apiSecret: 'secret'.repeat(8) }),
    rooms: { createRoom: async options => { requests.push(options); if (onCreate) await onCreate() }, deleteRoom: async name => { requests.push(name) } },
  })
})
after(async () => {
  if (!enabled) return
  if (app) await app.close()
  if (db) { await db.query('delete from tenants where id=any($1::uuid[])', [[tenant, other]]); await db.closeDb() }
})
test('reuniões exigem sessão e lead da própria empresa', { skip: !enabled }, async () => {
  assert.equal((await call('POST', `/api/leads/${lead}/meetings`, {}, 'none')).statusCode, 401)
  assert.equal((await call('POST', `/api/leads/${lead}/meetings`, {}, 'other')).statusCode, 404)
  const created = await call('POST', `/api/leads/${lead}/meetings`, {})
  assert.equal(created.statusCode, 201, created.body)
  meeting = created.json().meeting
  invitation = created.json().inviteToken
  assert.ok(invitation.length >= 40)
  const row = (await db.query('select invite_hash from lead_meetings where id=$1', [meeting.id])).rows[0]
  assert.notEqual(row.invite_hash, invitation)
})
test('convidado precisa convite e aceite e não recebe resultado interno', { skip: !enabled }, async () => {
  const url = `/api/meetings/${meeting.id}/join`
  assert.equal((await call('POST', url, { inviteToken: invitation, name: 'Lead', consent: false }, 'none')).statusCode, 400)
  assert.equal((await call('POST', url, { inviteToken: 'x'.repeat(43), name: 'Lead', consent: true }, 'none')).statusCode, 404)
  const joined = await call('POST', url, { inviteToken: invitation, name: 'Lead', consent: true }, 'none')
  assert.equal(joined.statusCode, 200, joined.body)
  assert.equal(joined.json().role, 'guest')
  assert.ok(joined.json().token)
  assert.equal(joined.json().assessment, undefined)
  assert.equal(requests.at(-1).maxParticipants, 2)
  assert.equal((await call('GET', `/api/meetings/${meeting.id}`, undefined, 'none')).statusCode, 401)
  assert.equal((await call('GET', `/api/meetings/${meeting.id}`, undefined, 'other')).statusCode, 404)
})
test('upload é autenticado, limitado e idempotente; transcrição não aceita texto do navegador', { skip: !enabled }, async () => {
  const beforeConsent = `/api/meetings/${meeting.id}/audio?chunkId=${randomUUID()}&speaker=host&startMs=0&durationMs=1000`
  assert.equal((await call('POST', beforeConsent, Buffer.alloc(30), 'host', { 'content-type': 'audio/webm' })).statusCode, 409, 'entrada do convidado não substitui aceite do anfitrião')
  assert.equal((await call('POST', `/api/meetings/${meeting.id}/join`, { consent: true })).statusCode, 200)
  const id = randomUUID(), url = `/api/meetings/${meeting.id}/audio?chunkId=${id}&speaker=guest&startMs=0&durationMs=15000`
  const headers = { 'content-type': 'audio/webm' }, audio = Buffer.alloc(80, 1)
  assert.equal((await call('POST', url, audio, 'none', headers)).statusCode, 401)
  assert.equal((await call('POST', url, audio, 'other', headers)).statusCode, 404)
  assert.equal((await call('POST', url, audio, 'host', headers)).statusCode, 202)
  assert.equal((await call('POST', url, audio, 'host', headers)).statusCode, 202)
  const rows = await db.query('select * from meeting_audio_chunks where meeting_id=$1', [meeting.id])
  assert.equal(rows.rowCount, 1)
  assert.equal(rows.rows[0].status, 'queued')
  assert.equal((await call('POST', url.replace('15000', '60000'), audio, 'host', headers)).statusCode, 400)
  assert.equal((await call('POST', `/api/meetings/${meeting.id}/audio`, { text: 'Inventado' })).statusCode, 415)
})
test('encerramento invalida convite, não aceita novo áudio e preserva fila pendente', { skip: !enabled }, async () => {
  const ended = await call('POST', `/api/meetings/${meeting.id}/end`, { captureComplete: false })
  assert.equal(ended.statusCode, 200, ended.body)
  const row = (await db.query('select * from lead_meetings where id=$1', [meeting.id])).rows[0]
  assert.equal(row.status, 'ended')
  assert.equal(row.capture_incomplete, true)
  assert.equal(row.analysis_status, 'queued')
  assert.equal((await call('POST', `/api/meetings/${meeting.id}/join`, { inviteToken: invitation, name: 'Lead', consent: true }, 'none')).statusCode, 410)
  const url = `/api/meetings/${meeting.id}/audio?chunkId=${randomUUID()}&speaker=host&startMs=0&durationMs=1000`
  assert.equal((await call('POST', url, Buffer.alloc(20), 'host', { 'content-type': 'audio/webm' })).statusCode, 409)
  assert.equal((await db.query('select status from leads where id=$1', [lead])).rows[0].status, 'open')
})
test('convite expirado não entra e revisão exige motivo sem apagar avaliação original', { skip: !enabled }, async () => {
  const created = (await call('POST', `/api/leads/${lead}/meetings`, {})).json()
  await db.query("update lead_meetings set invite_expires_at=now()-interval '1 minute' where id=$1", [created.meeting.id])
  assert.equal((await call('POST', `/api/meetings/${created.meeting.id}/join`, { inviteToken: created.inviteToken, name: 'Lead', consent: true }, 'none')).statusCode, 410)
  await db.query("update lead_meetings set analysis_status='complete',assessment=$2::jsonb where id=$1", [meeting.id, JSON.stringify({ verdict: 'insufficient_data' })])
  assert.equal((await call('POST', `/api/meetings/${meeting.id}/review`, { verdict: 'qualified', note: '' })).statusCode, 400)
  assert.equal((await call('POST', `/api/meetings/${meeting.id}/review`, { verdict: 'qualified', note: 'Confirmei os critérios com o lead.' })).statusCode, 201)
  assert.equal((await db.query('select assessment from lead_meetings where id=$1', [meeting.id])).rows[0].assessment.verdict, 'insufficient_data')
})

test('fila durável transcreve, descarta áudio processado, avalia e mantém o funil', { skip: !enabled }, async t => {
  const text = 'Preciso automatizar vendas. Tenho cinco mil reais. Sou o responsável pela decisão. Quero começar em trinta dias.'
  const fact = evidence => ({ status: 'met', evidence })
  let refuse = false
  const service = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume audio/json */ }
    response.setHeader('Content-Type', 'application/json')
    if (refuse) { response.statusCode = 503; response.end('{"error":"private-detail"}'); return }
    response.end(JSON.stringify(request.url === '/transcribe' ? { text } : { choices: [{ message: { content: JSON.stringify({ summary: 'Necessidade e prazo informados.', next_steps: ['Enviar proposta.'], criteria: { need: fact('Preciso automatizar vendas.'), budget: fact('Tenho cinco mil reais.'), authority: fact('Sou o responsável pela decisão.'), timeline: fact('Quero começar em trinta dias.') } }) } }] }))
  })
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => service.close(resolve)))
  const base = `http://127.0.0.1:${service.address().port}`
  process.env.MEETING_STT_URL = base; process.env.MEETING_STT_KEY = 'fixture-key'
  await db.query("insert into integrations(tenant_id,provider,metadata) values($1,'ai',$2::jsonb)", [tenant, JSON.stringify({ provider: 'qwen', baseUrl: `${base}/v1`, model: 'fixture-model' })])
  const { processMeetingQueue } = await import('../../dist-server/meeting-worker.js')
  // The audio queued by the earlier API test survives ending the call.
  await processMeetingQueue(value => value)
  const first = (await db.query('select status,audio,text from meeting_audio_chunks where meeting_id=$1', [meeting.id])).rows[0]
  assert.equal(first.status, 'done'); assert.equal(first.audio, null); assert.equal(first.text, text)
  const created = (await call('POST', `/api/leads/${lead}/meetings`, {})).json().meeting
  await call('POST', `/api/meetings/${created.id}/join`, { consent: true })
  await call('POST', `/api/meetings/${created.id}/audio?chunkId=${randomUUID()}&speaker=guest&startMs=0&durationMs=1000`, Buffer.alloc(30), 'host', { 'content-type': 'audio/webm' })
  await call('POST', `/api/meetings/${created.id}/end`, { captureComplete: true })
  await processMeetingQueue(value => value)
  await processMeetingQueue(value => value)
  const result = (await db.query('select assessment,analysis_status from lead_meetings where id=$1', [created.id])).rows[0]
  assert.equal(result.analysis_status, 'complete')
  assert.equal(result.assessment.verdict, 'qualified')
  await call('POST', `/api/meetings/${created.id}/end`, { captureComplete: false })
  assert.equal((await db.query('select capture_incomplete from lead_meetings where id=$1', [created.id])).rows[0].capture_incomplete, false, 'encerramento repetido é idempotente')
  assert.equal((await db.query('select status from leads where id=$1', [lead])).rows[0].status, 'open')
  const backlog = (await call('POST', `/api/leads/${lead}/meetings`, {})).json().meeting
  await call('POST', `/api/meetings/${backlog.id}/join`, { consent: true })
  for (let i = 0; i < 3; i++) await call('POST', `/api/meetings/${backlog.id}/audio?chunkId=${randomUUID()}&speaker=guest&startMs=${i * 1000}&durationMs=1000`, Buffer.alloc(30), 'host', { 'content-type': 'audio/webm' })
  const ready = (await call('POST', `/api/leads/${lead}/meetings`, {})).json().meeting
  await call('POST', `/api/meetings/${ready.id}/end`, { captureComplete: true })
  await processMeetingQueue(value => value); await processMeetingQueue(value => value)
  assert.equal((await db.query('select analysis_status from lead_meetings where id=$1', [ready.id])).rows[0].analysis_status, 'complete', 'outra sala com backlog não impede avaliação pronta')
  assert.ok(Number((await db.query("select count(*) from meeting_audio_chunks where meeting_id=$1 and status='queued'", [backlog.id])).rows[0].count) > 0)
  await db.query('delete from lead_meetings where id=any($1::uuid[])', [[backlog.id, ready.id]])
  // A failed transcription is retained for retry and never presented as an empty success.
  const broken = (await call('POST', `/api/leads/${lead}/meetings`, {})).json().meeting
  await call('POST', `/api/meetings/${broken.id}/join`, { consent: true })
  const chunkId = randomUUID()
  await call('POST', `/api/meetings/${broken.id}/audio?chunkId=${chunkId}&speaker=guest&startMs=0&durationMs=1000`, Buffer.alloc(30), 'host', { 'content-type': 'audio/webm' })
  refuse = true; await processMeetingQueue(value => value)
  const failure = (await db.query('select status,audio,error from meeting_audio_chunks where id=$1', [chunkId])).rows[0]
  assert.equal(failure.status, 'failed'); assert.ok(failure.audio); assert.ok(!failure.error.includes('private-detail'))
  refuse = false
  await call('POST', `/api/meetings/${broken.id}/retry`, {})
  await db.query("update meeting_audio_chunks set status='processing',processing_at=now()-interval '10 minutes' where id=$1", [chunkId])
  await processMeetingQueue(value => value)
  assert.equal((await db.query('select status from meeting_audio_chunks where id=$1', [chunkId])).rows[0].status, 'done')
})

test('encerrar enquanto uma entrada prepara a sala também remove a sala criada tardiamente', { skip: !enabled }, async t => {
  const created = (await call('POST', `/api/leads/${lead}/meetings`, {})).json().meeting
  let started, release
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  onCreate = async () => { started(); await gate }
  t.after(() => { onCreate = undefined; release() })
  const joining = Promise.resolve(call('POST', `/api/meetings/${created.id}/join`, { consent: true }))
  await began
  const roomName = requests.findLast(item => item && typeof item === 'object').name
  const before = requests.filter(item => item === roomName).length
  assert.equal((await call('POST', `/api/meetings/${created.id}/end`, { captureComplete: false })).statusCode, 200)
  release()
  assert.equal((await joining).statusCode, 410)
  assert.equal(requests.filter(item => item === roomName).length - before, 2, 'encerramento e entrada tardia removem a sala')
})
