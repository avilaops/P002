import type { CrmConversation, CrmMessage } from '../../lib/crm'
import { formatPhoneBR } from '../../lib/format'

export type MessageStatusIcon = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'

export type MessageDayGroup = {
  key: string
  label: string
  messages: CrmMessage[]
}

export const INBOX_RECONCILIATION_MS = 10_000

export function shouldReconcileInbox(visibilityState: DocumentVisibilityState, pending: boolean) {
  return visibilityState === 'visible' && !pending
}

function humanPhone(value: string | null | undefined) {
  const phone = value?.trim() ?? ''
  if (!phone || phone.includes('@') || !/\d/.test(phone)) return ''
  return formatPhoneBR(phone)
}

function humanName(value: string | null | undefined) {
  const name = value?.trim() ?? ''
  if (!name || /@(lid|g\.us|s\.whatsapp\.net)$/i.test(name)) return ''
  return name
}

export function contactLabel(conversation: CrmConversation) {
  return humanName(conversation.contact_name) || humanPhone(conversation.contact_phone) || 'Contato sem nome'
}

export function contactSecondaryLabel(conversation: CrmConversation) {
  const phone = humanPhone(conversation.contact_phone)
  if (humanName(conversation.contact_name) && phone) return phone
  return conversation.channel_name?.trim() || 'WhatsApp'
}

export function groupMessagesByDay(messages: CrmMessage[], timeZone: string): MessageDayGroup[] {
  const keyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const labelFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: 'long', year: 'numeric' })
  const groups: MessageDayGroup[] = []

  for (const message of messages) {
    const date = new Date(message.sent_at)
    const key = keyFormatter.format(date)
    const current = groups.at(-1)
    if (current?.key === key) current.messages.push(message)
    else groups.push({ key, label: labelFormatter.format(date), messages: [message] })
  }

  return groups
}

export function messageStatusMeta(status: string): { label: string; icon: MessageStatusIcon } {
  const states: Record<string, { label: string; icon: MessageStatusIcon }> = {
    pending: { label: 'Enviando', icon: 'pending' },
    queued: { label: 'Na fila', icon: 'pending' },
    sent: { label: 'Enviada', icon: 'sent' },
    delivered: { label: 'Entregue', icon: 'delivered' },
    read: { label: 'Lida', icon: 'read' },
    failed: { label: 'Falhou', icon: 'failed' },
  }
  return states[status] ?? { label: 'Status indisponível', icon: 'unknown' }
}

export function composerSubmitIntent(event: { key: string; shiftKey: boolean; isComposing: boolean }) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}
