import assert from 'node:assert/strict'
import test from 'node:test'
import { requestEvolution, EvolutionTimeoutError } from '../../src/lib/evolution'

test('uma consulta parada vence o prazo e permite uma nova tentativa', async t => {
  const keepAlive = setTimeout(() => {}, 2000)
  t.after(() => clearTimeout(keepAlive))
  const transport = t.mock.method(globalThis, 'fetch', async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  }))
  await assert.rejects(requestEvolution('status', new AbortController().signal, 15), EvolutionTimeoutError)
  transport.mock.mockImplementation(async () => Response.json({ state: 'connected' }))
  assert.equal((await requestEvolution<{ state: string }>('status', new AbortController().signal, 15)).state, 'connected')
})

test('cancelamento ao sair da tela não se transforma em erro de timeout nem inicia outra requisição', async t => {
  const transport = t.mock.method(globalThis, 'fetch', async () => { throw Error('não deve chamar') })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(requestEvolution('status', controller.signal), { name: 'AbortError' })
  assert.equal(transport.mock.callCount(), 0)
})
