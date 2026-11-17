import type { MailMessage } from '../../lib/mail'

export type MailThread = {
  key: string
  latest: MailMessage
  messages: MailMessage[]
  count: number
}

export function groupMailThreads(messages: MailMessage[]): MailThread[] {
  const byKey = new Map<string, MailMessage[]>()
  for (const message of messages) {
    const bucket = byKey.get(message.threadKey) ?? []
    bucket.push(message)
    byKey.set(message.threadKey, bucket)
  }
  return [...byKey.entries()].map(([key, threadMessages]) => {
    threadMessages.sort((left, right) => (left.date ?? '').localeCompare(right.date ?? ''))
    return { key, latest: threadMessages.at(-1)!, messages: threadMessages, count: threadMessages.length }
  }).sort((left, right) => (right.latest.date ?? '').localeCompare(left.latest.date ?? ''))
}
