import assert from 'node:assert/strict'
import test from 'node:test'
import { evolutionPairingView, nextEvolutionAction } from '../../src/lib/evolutionPairing'

const connecting = { state: 'connecting' as const, phone: null, instanceName: 'crm-test' }
const connected = { ...connecting, state: 'connected' as const, phone: '5516992348303' }

test('consulta inicial, preparação e QR pronto são estados diferentes', () => {
  assert.equal(evolutionPairingView(null, null, '').state, 'checking')
  assert.equal(evolutionPairingView(connecting, null, '').state, 'preparing')
  assert.equal(evolutionPairingView(connecting, 'qr', '').state, 'waiting')
})

test('conexão confirmada formata o número e não apresenta QR antigo', () => {
  const view = evolutionPairingView(connected, 'qr-antigo', '')
  assert.equal(view.state, 'connected')
  assert.equal(view.phone, '(16) 99234-8303')
  assert.equal(view.showQr, false)
})

test('falha de comunicação não usa o estado conectado nem um QR anterior como confirmação', () => {
  assert.equal(evolutionPairingView(connected, null, 'Falhou').state, 'error')
  assert.equal(evolutionPairingView(connecting, 'qr-antigo', 'Falhou').showQr, false)
})

test('desconectado só aparece após uma consulta concluída', () => {
  assert.equal(evolutionPairingView({ ...connecting, state: 'disconnected' }, null, '').state, 'disconnected')
})

const policy = { state: 'connecting' as const, canManage: true, hasQr: true, hasError: false, visible: true, pending: false, now: 30000, lastStatusAt: 29000, lastQrAt: 10000 }

test('QR é verificado após 20 segundos e status durante pareamento após 3 segundos', () => {
  assert.equal(nextEvolutionAction(policy), 'connect')
  assert.equal(nextEvolutionAction({ ...policy, lastQrAt: 25000, lastStatusAt: 27000 }), 'status')
  assert.equal(nextEvolutionAction({ ...policy, lastQrAt: 25000 }), null)
})

test('preparação sem QR tenta novamente após 5 segundos', () => {
  assert.equal(nextEvolutionAction({ ...policy, hasQr: false, lastQrAt: 25000 }), 'connect')
  assert.equal(nextEvolutionAction({ ...policy, hasQr: false, lastQrAt: 26000 }), null)
})

test('atendente, página oculta e requisição pendente não geram POST automático', () => {
  assert.equal(nextEvolutionAction({ ...policy, canManage: false }), null)
  assert.equal(nextEvolutionAction({ ...policy, visible: false }), null)
  assert.equal(nextEvolutionAction({ ...policy, pending: true }), null)
  assert.equal(nextEvolutionAction({ ...policy, canManage: false, lastStatusAt: 27000 }), 'status')
})

test('falha, conectado e desconectado usam consulta de status, sem gerar QR ou reconectar', () => {
  assert.equal(nextEvolutionAction({ ...policy, hasError: true }), null)
  assert.equal(nextEvolutionAction({ ...policy, hasError: true, lastStatusAt: 20000 }), 'status')
  assert.equal(nextEvolutionAction({ ...policy, state: 'connected', lastStatusAt: 20000 }), 'status')
  assert.equal(nextEvolutionAction({ ...policy, state: 'disconnected', lastStatusAt: 29000 }), null)
})
