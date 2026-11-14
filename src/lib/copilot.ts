export type CopilotMessage = { role: 'user' | 'assistant'; content: string }
export type CopilotSource = { id: string; title: string }

export function recentCopilotMessages(messages: CopilotMessage[]): CopilotMessage[] {
  const recent: CopilotMessage[] = []
  let length = 0
  for (const message of messages.slice(-12).reverse()) {
    const content = message.content.slice(0, 2000)
    if (length + content.length > 6000) break
    recent.unshift({ role: message.role, content })
    length += content.length
  }
  return recent
}
