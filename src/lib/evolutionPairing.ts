import { formatPhoneBR } from './format'

export type EvolutionStatus = {
  state: 'connected' | 'connecting' | 'disconnected'
  instanceName: string
  phone: string | null
  qrCode?: string | null
}
export type EvolutionAction = 'status' | 'connect' | 'sync'
export const QR_REFRESH_MS = 20000

export function evolutionPairingView(status: EvolutionStatus | null, qr: string | null, error: string) {
  const state = error ? 'error' : !status ? 'checking' : status.state === 'connected' ? 'connected'
    : status.state === 'connecting' ? qr ? 'waiting' : 'preparing' : 'disconnected'
  const title = {
    checking: 'Verificando conexão…', disconnected: 'Conecte o WhatsApp da sua empresa',
    preparing: 'Preparando seu QR Code…', waiting: 'Leia o QR Code no celular',
    connected: 'WhatsApp conectado', error: 'Precisamos verificar sua conexão',
  }[state]
  const phone = status?.phone ? formatPhoneBR(status.phone.startsWith('+') ? status.phone : `+${status.phone}`) : null
  return { state, title, phone, showQr: state === 'waiting' && Boolean(qr) }
}

export function nextEvolutionAction(input: {
  state: EvolutionStatus['state'] | null; canManage: boolean; hasQr: boolean; hasError: boolean
  visible: boolean; pending: boolean; now: number; lastStatusAt: number; lastQrAt: number
}): 'status' | 'connect' | null {
  if (!input.visible || input.pending) return null
  if (input.canManage && !input.hasError && input.state === 'connecting'
    && input.now - input.lastQrAt >= (input.hasQr ? QR_REFRESH_MS : 5000)) return 'connect'
  const interval = !input.hasError && input.state === 'connecting' ? 3000 : 10000
  return input.now - input.lastStatusAt >= interval ? 'status' : null
}
