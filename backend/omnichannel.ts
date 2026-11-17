import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type MetaMessagingEvent = {
  channelExternalId: string
  senderExternalId: string
  externalId: string
  body: string
  messageType: string
  sentAt: string
}

type MetaMessage = { mid?: unknown; text?: unknown; is_echo?: unknown; attachments?: unknown }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function attachmentType(message: MetaMessage) {
  if (!Array.isArray(message.attachments)) return ''
  const first = record(message.attachments[0])
  return text(first?.type).toLowerCase().slice(0, 30)
}

/** Normaliza somente mensagens recebidas. Ecos e eventos sem conteúdo não entram no inbox. */
export function parseMetaMessagingEvents(payload: unknown): MetaMessagingEvent[] {
  const root = record(payload)
  if (root?.object !== 'page' && root?.object !== 'instagram') return []
  if (!Array.isArray(root.entry)) return []

  const events: MetaMessagingEvent[] = []
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry)
    const channelExternalId = text(entry?.id)
    if (!channelExternalId || !Array.isArray(entry?.messaging)) continue

    for (const rawEvent of entry.messaging) {
      const event = record(rawEvent)
      const sender = record(event?.sender)
      const recipient = record(event?.recipient)
      const message = record(event?.message) as MetaMessage | null
      const senderExternalId = text(sender?.id)
      const recipientId = text(recipient?.id)
      const externalId = text(message?.mid)
      if (!message || message.is_echo === true || !senderExternalId || !externalId) continue
      if (senderExternalId === channelExternalId || (recipientId && recipientId !== channelExternalId)) continue

      const directText = text(message.text)
      const mediaType = attachmentType(message)
      if (!directText && !mediaType) continue
      const timestamp = typeof event?.timestamp === 'number' && Number.isFinite(event.timestamp)
        ? new Date(event.timestamp)
        : new Date()

      events.push({
        channelExternalId,
        senderExternalId,
        externalId,
        body: directText || `[${mediaType}]`,
        messageType: directText ? 'text' : mediaType,
        sentAt: timestamp.toISOString(),
      })
    }
  }
  return events
}

export function verifyMetaSignature(rawBody: Buffer, signature: string | string[] | undefined, appSecret: string) {
  const value = Array.isArray(signature) ? signature[0] : signature
  if (!value?.startsWith('sha256=') || !appSecret) return false
  const supplied = value.slice(7)
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  if (supplied.length !== expected.length || !/^[a-f0-9]+$/i.test(supplied)) return false
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
}

export function hashVisitorToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function allowedWidgetOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return false
  if (allowedOrigins.includes('*')) return true
  let normalized: string
  try {
    normalized = new URL(origin).origin
  } catch {
    return false
  }
  return allowedOrigins.some((candidate) => {
    try {
      return new URL(candidate).origin === normalized
    } catch {
      return false
    }
  })
}
