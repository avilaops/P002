import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { registerMailReplyRoutes, replyEmail } from '../../dist-server/mail-reply.js'

test('resposta usa destinatário original e cabeçalhos seguros', () => {
  const email = replyEmail({ to: 'reply@example.com', subject: 'Olá\r\nBcc: bad', messageId: '<original@example.com>', references: '<older@example.com>\r\nBcc: bad' }, 'Minha resposta')
  assert.equal(email.to, 'reply@example.com')
  assert.equal(email.subject, 'Re: Olá Bcc: bad')
  assert.deepEqual(email.headers, { 'In-Reply-To': '<original@example.com>', References: '<older@example.com> <original@example.com>' })
  assert.equal(email.text, 'Minha resposta')
})

async function fixture(t, overrides = {}) {
  const app = Fastify()
  const sent = []
  const claims = new Map()
  registerMailReplyRoutes(app, {
    requireAuth: async () => ({ id: 'user', tenant_id: 'tenant-session' }),
    decryptSecret: value => value,
    loadAccount: async tenant => { assert.equal(tenant, 'tenant-session'); return { user: 'account@example.com' } },
    fetchTarget: async () => ({ to: 'original@example.com', subject: 'Assunto', messageId: '<original@example.com>', references: '' }),
    lookup: async key => claims.has(key) ? { acquired: false, ...claims.get(key) } : null,
    claim: async (key, fingerprint) => { if (claims.has(key)) return { acquired: false, ...claims.get(key) }; claims.set(key, { fingerprint, state: 'pending' }); return { acquired: true, fingerprint, state: 'pending' } },
    finish: async key => { claims.get(key).state = 'sent' },
    send: async (_account, email) => { sent.push(email); return '<sent@example.com>' },
    ...overrides,
  })
  t.after(() => app.close())
  return { app, sent }
}
const payload = { text: 'Resposta', requestId: '7ea28d03-726d-469e-b571-e79421997c61' }
test('autenticação precede leitura e envio', async t => {
  const { app, sent } = await fixture(t, { requireAuth: async (_req, reply) => { reply.code(401).send({ error: 'login' }); return null }, loadAccount: () => assert.fail('não ler conta') })
  assert.equal((await app.inject({ method: 'POST', url: '/api/mail/messages/1/reply', payload })).statusCode, 401)
  assert.equal(sent.length, 0)
})
test('isola tenant, ignora destinos do navegador e não repete envio', async t => {
  const { app, sent } = await fixture(t)
  const request = { method: 'POST', url: '/api/mail/messages/1/reply?tenant=other', payload: { ...payload, to: 'attacker@example.com' } }
  assert.equal((await app.inject(request)).statusCode, 200)
  assert.equal((await app.inject(request)).statusCode, 200)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'original@example.com')
  assert.equal((await app.inject({ ...request, payload: { ...payload, text: 'Outra' } })).statusCode, 409)
})
test('falha SMTP não expõe detalhes nem permite duplicar envio incerto', async t => {
  const { app } = await fixture(t, { send: async () => { throw new Error('password=secret provider failure') } })
  const request = { method: 'POST', url: '/api/mail/messages/1/reply', payload }
  const response = await app.inject(request)
  assert.equal(response.statusCode, 502)
  assert.doesNotMatch(response.body, /secret|password/)
  assert.match(response.json().error, /Peça a um administrador/)
  assert.doesNotMatch(response.json().error, /caixa de enviados/)
  assert.equal((await app.inject(request)).statusCode, 409)
})

test('repetição de resposta enviada não depende de IMAP disponível', async t => {
  let reads = 0
  const { app, sent } = await fixture(t, { fetchTarget: async () => {
    reads++
    if (reads > 1) throw new Error('IMAP unavailable')
    return { to: 'original@example.com', subject: 'Assunto', messageId: '', references: '' }
  } })
  const request = { method: 'POST', url: '/api/mail/messages/1/reply', payload }
  assert.equal((await app.inject(request)).statusCode, 200)
  assert.equal((await app.inject(request)).statusCode, 200)
  assert.equal(reads, 1)
  assert.equal(sent.length, 1)
})

test('mensagem ou destinatário inválido impede envio', async t => {
  const { app, sent } = await fixture(t, { fetchTarget: async () => ({ to: 'good@example.com\r\nBcc: bad@example.com', subject: 'Assunto', messageId: '', references: '' }) })
  const response = await app.inject({ method: 'POST', url: '/api/mail/messages/1/reply', payload })
  assert.equal(response.statusCode, 502)
  assert.equal(sent.length, 0)
  assert.equal((await app.inject({ method: 'POST', url: '/api/mail/messages/1/reply', payload: { ...payload, text: ' ' } })).statusCode, 400)
})

test('requisições concorrentes enviam uma única resposta', async t => {
  let release
  const waiting = new Promise(resolve => { release = resolve })
  let sendCount = 0
  const { app } = await fixture(t, { send: async () => { sendCount++; await waiting; return '<sent@example.com>' } })
  const request = { method: 'POST', url: '/api/mail/messages/1/reply', payload }
  const first = app.inject(request).then(response => response)
  const second = app.inject(request).then(response => response)
  // Aguarda o segundo pedido encontrar a reserva enquanto o primeiro envia.
  const duplicate = await second
  assert.equal(duplicate.statusCode, 409)
  release()
  assert.equal((await first).statusCode, 200)
  assert.equal(sendCount, 1)
})
