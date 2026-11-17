import { api } from './crm'

const json = { 'Content-Type': 'application/json' }

export type ErpStatus = {
  connected: boolean
  baseUrl: string | null
  erpTenantId: string | null
  settings: { autoWinLeadOnOrder?: boolean; createMissingContacts?: boolean } | null
  pendingEvents: number
  links: Record<string, number>
}

export function getErpStatus() {
  return api<ErpStatus>('/api/integrations/erp/status')
}

export type ErpInboundEvent = { id: string; event_type: string; created_at: string; processed_at: string | null; error: string | null }

export function getErpEvents() {
  return api<{events: ErpInboundEvent[]}>('/api/integrations/erp/inbound?limit=20&pendingFirst=true')
}

export function retryErpEvent(id: string) {
  return api<{ok: boolean}>(`/api/integrations/erp/inbound/${id}/retry`, {method: 'POST'})
}

export function connectErp(input: {
  baseUrl: string
  apiKey: string
  webhookSecret: string
  erpTenantId: string
  settings: { autoWinLeadOnOrder: boolean; createMissingContacts: boolean }
}) {
  return api<{ ok: boolean }>('/api/integrations/erp/connect', { method: 'POST', headers: json, body: JSON.stringify(input) })
}

export function disconnectErp() {
  return api<{ ok: boolean }>('/api/integrations/erp/disconnect', { method: 'POST' })
}
