import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionStateFromSettled, connectionSummary, integrationDefinitions } from '../../src/features/settings/settingsPresentation'

test('catálogo de integrações não repete canais de conversa', () => {
  assert.deepEqual(integrationDefinitions.map((item) => item.id), [
    'threads',
    'messageria',
    'erp',
    'google',
    'n8n',
    'pagamentos',
  ])
  assert.equal(integrationDefinitions.some((item) => item.id === 'whatsapp' || item.id === 'email'), false)
})

test('resumo distingue ativos, atenção, indisponíveis e carregando', () => {
  assert.deepEqual(connectionSummary(['connected', 'error', 'disconnected', 'soon', null]), {
    active: 1,
    attention: 2,
    unavailable: 1,
    loading: 1,
  })
})

test('cada integração oferece ação e estado textual explícitos', () => {
  for (const item of integrationDefinitions) {
    assert.ok(item.action.length > 0, item.id)
    assert.ok(item.unavailableLabel.length > 0, item.id)
  }
})

test('falha de consulta vira erro em vez de carregamento permanente', () => {
  const rejected: PromiseRejectedResult = { status: 'rejected', reason: new Error('offline') }
  const fulfilled: PromiseFulfilledResult<{ connected: boolean }> = { status: 'fulfilled', value: { connected: true } }
  assert.equal(connectionStateFromSettled(rejected, () => 'connected'), 'error')
  assert.equal(connectionStateFromSettled(fulfilled, (value) => value.connected ? 'connected' : 'disconnected'), 'connected')
})
