import assert from 'node:assert/strict'
import test from 'node:test'
import { groupMailThreads } from '../../src/features/workspace/mailPresentation'
import type { MailMessage } from '../../src/lib/mail'

function message(input: Partial<MailMessage> & Pick<MailMessage, 'uid' | 'subject'>): MailMessage {
  return { uid: input.uid, subject: input.subject, fromName: '', fromEmail: 'ana@example.test', to: [], date: null, seen: false, threadKey: input.threadKey ?? input.subject, contactId: input.contactId ?? null }
}

test('agrupa e ordena conversas de e-mail pela mensagem mais recente', () => {
  const threads = groupMailThreads([
    message({ uid: 1, subject: 'Pedido', threadKey: 'pedido:ana', date: '2026-11-16T10:00:00Z' }),
    message({ uid: 2, subject: 'Re: Pedido', threadKey: 'pedido:ana', date: '2026-11-17T10:00:00Z' }),
    message({ uid: 3, subject: 'Proposta', threadKey: 'proposta:ana', date: '2026-11-15T10:00:00Z' }),
  ])
  assert.equal(threads.length, 2)
  assert.equal(threads[0].latest.uid, 2)
  assert.equal(threads[0].count, 2)
  assert.deepEqual(threads[0].messages.map((item) => item.uid), [1, 2])
})
