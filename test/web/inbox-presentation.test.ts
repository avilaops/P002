import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contactLabel,
  contactSecondaryLabel,
  composerSubmitIntent,
  groupMessagesByDay,
  INBOX_RECONCILIATION_MS,
  messageStatusMeta,
  shouldReconcileInbox,
} from '../../src/features/workspace/inboxPresentation'
import type { CrmConversation, CrmMessage } from '../../src/lib/crm'

function conversation(overrides: Partial<CrmConversation> = {}): CrmConversation {
  return {
    id: 'conversation-1',
    contact_id: null,
    status: 'open',
    assigned_user_id: null,
    contact_name: null,
    contact_phone: null,
    channel_name: 'WhatsApp',
    channel_phone: null,
    channel_provider: 'whatsapp',
    assigned_user_name: null,
    last_message_at: null,
    last_customer_message_at: null,
    waiting_seconds: 0,
    unassigned: true,
    unread_count: 0,
    window_expires_at: null,
    window_open: true,
    ...overrides,
  }
}

function message(id: string, sentAt: string): CrmMessage {
  return {
    id,
    conversation_id: 'conversation-1',
    direction: 'inbound',
    sender_name: null,
    sender_phone: null,
    body: id,
    message_type: 'text',
    status: 'delivered',
    sent_at: sentAt,
  }
}

test('identidade prioriza nome e telefone humano sem mostrar LID', () => {
  assert.equal(contactLabel(conversation({ contact_name: 'Wílian Silveira', contact_phone: '1203634173120565446@lid' })), 'Wílian Silveira')
  assert.equal(contactSecondaryLabel(conversation({ contact_name: 'Wílian Silveira', contact_phone: '1203634173120565446@lid' })), 'WhatsApp')
  assert.equal(contactLabel(conversation({ contact_phone: '17997811471' })), '(17) 99781-1471')
  assert.equal(contactLabel(conversation({ contact_phone: '1203634173120565446@lid' })), 'Contato sem nome')
  assert.equal(contactLabel(conversation({ contact_name: '1203634173120565446@lid', contact_phone: '1203634173120565446@lid' })), 'Contato sem nome')
  assert.equal(contactLabel(conversation({ contact_phone: '(17) 99781-1471' })), '(17) 99781-1471')
  assert.equal(contactSecondaryLabel(conversation({ contact_name: 'Wílian Silveira', contact_phone: '(17) 99781-1471' })), '(17) 99781-1471')
})

test('agrupamento preserva ordem e cria um divisor por dia', () => {
  const groups = groupMessagesByDay([
    message('a', '2026-11-16T12:00:00.000Z'),
    message('b', '2026-11-16T13:00:00.000Z'),
    message('c', '2026-11-17T09:00:00.000Z'),
  ], 'America/Sao_Paulo')

  assert.deepEqual(groups.map((group) => group.messages.map((item) => item.id)), [['a', 'b'], ['c']])
  assert.deepEqual(groupMessagesByDay([], 'America/Sao_Paulo'), [])
})

test('status de mensagem tem rótulo acessível e fallback seguro', () => {
  assert.deepEqual(messageStatusMeta('read'), { label: 'Lida', icon: 'read' })
  assert.deepEqual(messageStatusMeta('unknown-provider-state'), { label: 'Status indisponível', icon: 'unknown' })
})

test('Enter envia e Shift Enter preserva quebra de linha', () => {
  assert.equal(composerSubmitIntent({ key: 'Enter', shiftKey: false, isComposing: false }), true)
  assert.equal(composerSubmitIntent({ key: 'Enter', shiftKey: true, isComposing: false }), false)
  assert.equal(composerSubmitIntent({ key: 'Enter', shiftKey: false, isComposing: true }), false)
  assert.equal(composerSubmitIntent({ key: 'a', shiftKey: false, isComposing: false }), false)
})

test('reconciliação automática roda somente com a caixa visível e sem consulta pendente', () => {
  assert.equal(INBOX_RECONCILIATION_MS, 10_000)
  assert.equal(shouldReconcileInbox('visible', false), true)
  assert.equal(shouldReconcileInbox('visible', true), false)
  assert.equal(shouldReconcileInbox('hidden', false), false)
})
