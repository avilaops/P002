import { api } from './crm'

export type SocialChannelStatus = {
  id: string
  provider: 'instagram' | 'messenger'
  external_id: string
  display_name: string
  status: string
  error_message: string | null
  updated_at: string
}

export type MetaMessagingStatus = {
  connected: boolean
  account: string | null
  channels: SocialChannelStatus[]
}

function isSocialChannel(value: unknown): value is SocialChannelStatus {
  if (!value || typeof value !== 'object') return false
  const channel = value as Partial<SocialChannelStatus>
  return typeof channel.id === 'string'
    && (channel.provider === 'instagram' || channel.provider === 'messenger')
    && typeof channel.external_id === 'string'
    && typeof channel.display_name === 'string'
    && typeof channel.status === 'string'
}

export async function getMetaMessagingStatus(): Promise<MetaMessagingStatus> {
  const result = await api<Partial<MetaMessagingStatus> | null>('/api/channels/meta-messaging')
  const channels = Array.isArray(result?.channels) ? result.channels.filter(isSocialChannel) : []
  return {
    connected: result?.connected === true,
    account: typeof result?.account === 'string' ? result.account : null,
    channels,
  }
}

export function saveMetaMessaging(input: {
  pageId: string
  pageName: string
  instagramId?: string
  instagramName?: string
  accessToken: string
  appSecret: string
  verifyToken: string
}) {
  return api<{ connected: true }>('/api/channels/meta-messaging', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function disconnectMetaMessaging() {
  return api<{ connected: false }>('/api/channels/meta-messaging', { method: 'DELETE' })
}

export type WebChatChannel = {
  external_id: string
  display_name: string
  status: string
  metadata: {
    allowedOrigins?: string[]
    brandColor?: string
    welcomeMessage?: string
  }
}

export async function getWebChatChannel(): Promise<{ channel: WebChatChannel | null; embedCode: string | null }> {
  const result = await api<{ channel?: WebChatChannel | null; embedCode?: string | null } | null>('/api/channels/webchat')
  const channel = result?.channel
  return {
    channel: channel && typeof channel.external_id === 'string' && typeof channel.display_name === 'string' ? channel : null,
    embedCode: typeof result?.embedCode === 'string' ? result.embedCode : null,
  }
}

export function saveWebChatChannel(input: { name: string; allowedOrigins: string[]; brandColor: string; welcomeMessage: string }) {
  return api<{ channel: WebChatChannel; embedCode: string }>('/api/channels/webchat', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
