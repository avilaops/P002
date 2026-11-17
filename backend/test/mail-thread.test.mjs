import assert from 'node:assert/strict'
import test from 'node:test'
import { mailThreadKey, normalizeMailSubject } from '../../dist-server/mail.js'

test('chave de conversa remove prefixos de resposta sem misturar remetentes', () => {
  assert.equal(normalizeMailSubject(' Re: ENC:  Pedido 123 '), 'pedido 123')
  assert.equal(mailThreadKey('Re: Pedido 123', 'ana@example.test'), mailThreadKey('Pedido 123', 'ana@example.test'))
  assert.notEqual(mailThreadKey('Pedido 123', 'ana@example.test'), mailThreadKey('Pedido 123', 'outra@example.test'))
})
