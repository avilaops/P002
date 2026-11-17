import type { CrmConversation, CrmMessage } from '../../lib/crm'
import { formatPhoneBR } from '../../lib/format'

export type MessageStatusIcon = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'

export type MessageDayGroup = {
  key: string
  label: string
  messages: CrmMessage[]
}

function humanPhone(value: string | null | undefined) {
  const phone = value?.trim() ?? ''
  if (!phone || phone.includes('@') || /\D/.test(phone.replace(/^\+/, ''))) return ''
  return formatPhoneBR(phone)
}

export function contactLabel(conversation: CrmConversation) {
  return conversation.contact_name?.trim() || humanPhone(conversation.contact_phone) || 'Contato sem nome'
}

export function contactSecondaryLabel(conversation: CrmConversation) {
  const phone = humanPhone(conversation.contact_phone)
  if (conversation.contact_name?.trim() && phone) return phone
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
