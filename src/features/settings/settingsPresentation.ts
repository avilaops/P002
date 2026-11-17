import type { ConnectionState } from '../../lib/connection'

export type IntegrationDefinition = {
  id: 'threads' | 'messageria' | 'erp' | 'google' | 'n8n' | 'pagamentos'
  name: string
  description: string
  action: string
  unavailableLabel: string
}

export const integrationDefinitions: IntegrationDefinition[] = [
  { id: 'threads', name: 'Threads', description: 'Publicações e resultados da conta da empresa', action: 'Configurar', unavailableLabel: 'Requer configuração' },
  { id: 'messageria', name: 'Messageria Ávila Ops', description: 'Entrega, janela de 24h, modelos e custos do WhatsApp', action: 'Gerenciar', unavailableLabel: 'Requer configuração' },
  { id: 'erp', name: 'ERP Ávila Ops', description: 'Clientes, pedidos e pagamentos na linha do tempo', action: 'Configurar', unavailableLabel: 'Requer configuração' },
  { id: 'google', name: 'Google Agenda', description: 'Tarefas e reuniões na agenda da equipe', action: 'Conectar', unavailableLabel: 'Requer configuração' },
  { id: 'n8n', name: 'n8n', description: 'Automações enviadas aos fluxos por webhook', action: 'Gerenciar', unavailableLabel: 'Gerenciado por automação' },
  { id: 'pagamentos', name: 'Pagamentos', description: 'Links de pagamento e status no negócio', action: 'Ver detalhes', unavailableLabel: 'Indisponível' },
]

export function connectionSummary(states: Array<ConnectionState | null>) {
  return states.reduce(
    (summary, state) => {
      if (state === null) summary.loading += 1
      else if (state === 'connected') summary.active += 1
      else if (state === 'soon') summary.unavailable += 1
      else summary.attention += 1
      return summary
    },
    { active: 0, attention: 0, unavailable: 0, loading: 0 },
  )
}
