import assert from 'node:assert/strict'
import test from 'node:test'
import { recentCopilotMessages, type CopilotMessage } from '../../src/lib/copilot'

test('histórico do Copiloto preserva pergunta recente e respeita quantidade e tamanho total', () => {
  const messages: CopilotMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i}: ${'a'.repeat(700)}` }))
  messages.push({ role: 'user', content: 'Esta é minha pergunta atual.' })
  const recent = recentCopilotMessages(messages)
  assert.ok(recent.length <= 12)
  assert.ok(recent.reduce((size, message) => size + message.content.length, 0) <= 6000)
  assert.deepEqual(recent.at(-1), messages.at(-1))
  assert.deepEqual(recent, messages.slice(-recent.length))
  assert.equal(messages.length, 21, 'histórico visível continua inteiro')
})

test('resposta longa pode ser exibida inteira sem exceder limite individual do histórico enviado', () => {
  const long = { role: 'assistant' as const, content: 'texto'.repeat(1000) }
  const recent = recentCopilotMessages([long, { role: 'user', content: 'Pode explicar?' }])
  assert.equal(recent[0].content.length, 2000)
  assert.equal(long.content.length, 5000)
})

test('novo chat vazio não reutiliza mensagens anteriores', () => {
  assert.deepEqual(recentCopilotMessages([]), [])
})

test('proxy de desenvolvimento permite que a API conclua seu deadline de 90 segundos', async () => {
  const { default: config } = await import('../../next.config.mjs')
  assert.ok(config.experimental?.proxyTimeout >= 100000)
})
