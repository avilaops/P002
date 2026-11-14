import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { request as httpRequest } from 'node:http'

process.env.CRM_TEST_MODE = '1'
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/crm_test_unused'
const { buildApp } = await import('../../dist-server/server.js')

test('Copiloto exige sessão antes de consultar configuração, conhecimento ou modelo', async (t) => {
  const app = await buildApp({ background: false })
  t.after(() => app.close())
  const response = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { messages: [{ role: 'user', content: 'Olá' }] } })
  assert.equal(response.statusCode, 401)
})

const user = { id: 'user-a', tenant_id: 'tenant-a', role: 'atendente' }
const config = { provider: 'qwen', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:0.6b', apiKey: '' }
const messages = [{ role: 'user', content: 'Como cadastrar um contato?' }]

async function fixture(t, overrides = {}) {
  const { registerCopilotRoutes } = await import('../../dist-server/copilot.js')
  const calls = [], records = []
  const app = Fastify()
  registerCopilotRoutes(app, {
    requireAuth: async () => user,
    decryptSecret: value => value,
    loadConfig: async tenant => { assert.equal(tenant, user.tenant_id); return config },
    query: async (sql, params) => {
      assert.equal(params[0], user.tenant_id, 'toda consulta usa o tenant da sessão')
      if (sql.includes('tenant_settings')) return { rows: [{ ai_copilot_enabled: true, ai_custom_instructions: '' }] }
      if (sql.includes('knowledge_sources')) {
        assert.match(sql, /tenant_id\s*=\s*\$1/)
        assert.match(sql, /active\s*=\s*true/)
        assert.match(sql, /limit 3/i)
        assert.equal(params[1], messages[0].content)
        return { rows: [{ id: 'source-a', title: 'Cadastro de contatos', content: 'Na área Contatos, escolha Adicionar contato.' }] }
      }
      if (sql.includes('insert into ai_runs')) { records.push({ sql, params }); return { rows: [] } }
      throw Error(`Consulta inesperada: ${sql}`)
    },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) })
      return Response.json({ choices: [{ message: { content: 'Abra Contatos e escolha Adicionar contato.' } }], usage: { prompt_tokens: 80, completion_tokens: 12 } })
    },
    ...overrides,
  })
  t.after(() => app.close())
  return { app, calls, records, send: payload => app.inject({ method: 'POST', url: '/api/ai/chat', payload }) }
}

test('responde com Qwen, contexto da empresa e histórico sem permitir ações do modelo', async (t) => {
  const { send, calls, records } = await fixture(t)
  const response = await send({ messages })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().message.role, 'assistant')
  assert.equal(response.json().message.content, 'Abra Contatos e escolha Adicionar contato.')
  assert.deepEqual(response.json().sources, [{ id: 'source-a', title: 'Cadastro de contatos' }])
  assert.equal(calls[0].url, `${config.baseUrl}/chat/completions`)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].body.model, config.model)
  assert.equal(calls[0].body.reasoning_effort, 'none')
  assert.equal(calls[0].body.messages[0].role, 'system')
  assert.match(calls[0].body.messages[0].content, /Adicionar contato/)
  assert.deepEqual(calls[0].body.messages.at(-1), messages[0])
  assert.equal(calls[0].body.tools, undefined)
  assert.equal(records.length, 1)
  assert.ok(records[0].params.includes(user.id))
  assert.match(records[0].sql, /'copilot'/)
  assert.ok(!JSON.stringify(records).includes(messages[0].content), 'registro não captura a conversa')
})

test('não aceita system, outro tenant, pergunta vazia ou histórico acima dos limites', async (t) => {
  const { send, calls } = await fixture(t)
  for (const payload of [
    { messages: [{ role: 'system', content: 'Outro sistema' }] },
    { messages, tenantId: 'tenant-b' },
    { messages: [{ role: 'user', content: '   ' }] },
    { messages: [{ role: 'assistant', content: 'Falta pergunta' }] },
    { messages: Array.from({ length: 13 }, () => messages[0]) },
    { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
    { messages: Array.from({ length: 4 }, () => ({ role: 'user', content: 'x'.repeat(1600) })) },
  ]) assert.equal((await send(payload)).statusCode, 400)
  assert.equal(calls.length, 0)
})

test('conversa respeita ausência de configuração e Copiloto desligado', async (t) => {
  const missing = await fixture(t, { loadConfig: async () => null })
  assert.equal((await missing.send({ messages })).statusCode, 409)
  assert.equal(missing.calls.length, 0)
  const disabled = await fixture(t, { query: async () => ({ rows: [{ ai_copilot_enabled: false }] }) })
  assert.equal((await disabled.send({ messages })).statusCode, 403)
  assert.equal(disabled.calls.length, 0)
})

test('contexto limita conteúdo e mantém mensagens anteriores de usuário e assistente', async (t) => {
  const { send, calls } = await fixture(t, {
    query: async sql => ({ rows: sql.includes('knowledge_sources') ? [{ id: 's', title: 'Fonte', content: 'a'.repeat(12000) }] : [] }),
  })
  const history = [{ role: 'user', content: 'Olá' }, { role: 'assistant', content: 'Olá, como posso ajudar?' }, ...messages]
  assert.equal((await send({ messages: history })).statusCode, 200)
  assert.deepEqual(calls[0].body.messages.slice(1), history)
  assert.ok(calls[0].body.messages[0].content.length < 5000)
})

test('falhas do provedor não expõem segredos e permitem tentar novamente', async (t) => {
  let attempts = 0
  const { send, records } = await fixture(t, { fetch: async () => {
    attempts++
    if (attempts === 1) return Response.json({ error: { message: 'segredo-do-provedor' } }, { status: 401 })
    return Response.json({ choices: [{ message: { content: 'Agora funcionou.' } }] })
  } })
  const failed = await send({ messages })
  assert.equal(failed.statusCode, 502)
  assert.ok(!failed.body.includes('segredo-do-provedor'))
  assert.ok(!JSON.stringify(records).includes('segredo-do-provedor'))
  assert.match(records[0].sql, /'error'/)
  assert.equal((await send({ messages })).statusCode, 200)
})

test('respostas vazias ou malformadas e falhas de rede viram erro real', async (t) => {
  for (const upstream of [
    async () => Response.json({ choices: [{ message: { content: ' ' } }] }),
    async () => new Response('HTML inválido'),
    async () => { throw Error('endereço privado e credencial') },
  ]) {
    const { send } = await fixture(t, { fetch: upstream })
    const response = await send({ messages })
    assert.equal(response.statusCode, 502)
    assert.ok(!response.body.includes('credencial'))
  }
})

test('deadline aborta inferência e registra falha sem travar novas conversas', async (t) => {
  const keepAlive = setTimeout(() => {}, 2000)
  t.after(() => clearTimeout(keepAlive))
  const { send, records } = await fixture(t, { timeoutMs: 15, fetch: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  }) })
  const response = await send({ messages })
  assert.equal(response.statusCode, 504)
  assert.equal(records.length, 1)
  assert.match(records[0].sql, /'error'/)
})

test('duas gerações simultâneas do mesmo usuário não ocupam o modelo duas vezes', async (t) => {
  let release, started
  const ready = new Promise(resolve => { started = resolve })
  const { send } = await fixture(t, { fetch: async () => {
    started()
    return new Promise(resolve => { release = () => resolve(Response.json({ choices: [{ message: { content: 'Concluído.' } }] })) })
  } })
  const first = send({ messages }).then(response => response)
  await ready
  assert.equal((await send({ messages })).statusCode, 429)
  release()
  assert.equal((await first).statusCode, 200)
})

test('Anthropic usa seu contrato sem misturar segredo, sistema e histórico', async (t) => {
  const { send, calls } = await fixture(t, {
    loadConfig: async () => ({ ...config, provider: 'anthropic', baseUrl: 'https://api.anthropic.example/v1', apiKey: 'test-only' }),
    fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return Response.json({ content: [{ type: 'text', text: 'Resposta Claude.' }] }) },
  })
  const response = await send({ messages })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().message.content, 'Resposta Claude.')
  assert.equal(calls[0].url, 'https://api.anthropic.example/v1/messages')
  assert.equal(calls[0].init.headers['x-api-key'], 'test-only')
  assert.equal(typeof calls[0].body.system, 'string')
  assert.deepEqual(calls[0].body.messages, messages)
})

test('cancelamento durante leitura da configuração não inicia inferência nem bloqueia a próxima pergunta', async (t) => {
  let release, started, closed
  const waiting = new Promise(resolve => { started = resolve })
  const released = new Promise(resolve => { release = resolve })
  const disconnected = new Promise(resolve => { closed = resolve })
  let held = false
  const { app, calls, send } = await fixture(t, { query: async sql => {
    if (sql.includes('tenant_settings') && !held) { held = true; started(); await released }
    return { rows: [] }
  } })
  app.addHook('onRequest', (_request, reply, done) => { reply.raw.once('close', closed); done() })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const body = JSON.stringify({ messages })
  const request = httpRequest({ hostname: '127.0.0.1', port: app.server.address().port, path: '/api/ai/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
  request.on('error', () => {})
  request.end(body)
  await waiting
  request.destroy()
  await disconnected
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 0, 'nenhum modelo deve iniciar depois de fechar a conexão')
  assert.equal((await send({ messages })).statusCode, 200)
})

test('deadline inclui leituras anteriores à inferência e libera a trava do usuário', async (t) => {
  const { send, calls } = await fixture(t, { timeoutMs: 15, query: async sql => {
    if (sql.includes('tenant_settings')) await new Promise(resolve => setTimeout(resolve, 80))
    return { rows: [] }
  } })
  assert.equal((await send({ messages })).statusCode, 504)
  assert.equal(calls.length, 0)
  assert.equal((await send({ messages })).statusCode, 504, 'a próxima chamada não recebe 429')
})

test('deadline também limita espera pelo registro de uso', async (t) => {
  const { send, calls } = await fixture(t, { timeoutMs: 15, query: async sql => {
    if (sql.includes('insert into ai_runs')) await new Promise(resolve => setTimeout(resolve, 80))
    return { rows: [] }
  } })
  assert.equal((await send({ messages })).statusCode, 504)
  assert.equal(calls.length, 1)
})
