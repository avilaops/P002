import { Calendar, CreditCard, Database, MessageCircle, Send, Workflow, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { FormField, Notice, ToggleRow } from '../../components/ui/Form'
import { Sheet } from '../../components/ui/Sheet'
import { LoadingStatusBadge, StatusBadge } from '../../components/ui/StatusBadge'
import type { ConnectionState } from '../../lib/connection'
import { ApiError } from '../../lib/crm'
import { disconnectGoogleIntegration, getGoogleAuthUrl, getGoogleIntegrationStatus } from '../../lib/googleCalendar'
import { connectErp, disconnectErp, getErpStatus, type ErpStatus } from '../../lib/integrations'
import { getMessageriaStatus, type MessageriaStatus } from '../../lib/messageria'
import { useNavigation } from '../../lib/navigationContext'
import { buttonClass } from '../../lib/ui'
import type { Page } from '../../types'
import { SettingsFrame } from './SettingsFrame'
import { getThreadsStatus, type ThreadsStatus } from '../../lib/threads'
import { ThreadsSheet } from './ThreadsSheet'
import { connectionSummary, integrationDefinitions } from './settingsPresentation'

type Item = {
  id: string
  name: string
  description: string
  icon: LucideIcon
  state: ConnectionState | null
  /** Texto do selo quando o estado padrão não diz o suficiente. */
  stateLabel?: string
  actionLabel: string
  onOpen?: () => void
}

/**
 * Central de integrações: um catálogo só, com estado real de cada conexão.
 *
 * O que estava aqui gravava chave de API do ERP, do n8n e token da Twilio no
 * `localStorage` do navegador — legível por qualquer script da página — e
 * mostrava "Ativo" para o n8n sempre (`!!chave || true`) e para três gateways
 * de pagamento que o servidor nunca teve. Agora cada estado vem do servidor, e
 * segredo só sobe: fica cifrado lá e nunca volta para a tela.
 */
export default function IntegrationCenterPage() {
  const { navigate } = useNavigation()
  const [messageria, setMessageria] = useState<MessageriaStatus | null>(null)
  const [erp, setErp] = useState<ErpStatus | null>(null)
  const [google, setGoogle] = useState<{ connected: boolean; email?: string } | null>(null)
  const [erpOpen, setErpOpen] = useState(false)
  const [threads, setThreads] = useState<ThreadsStatus | null>(null)
  const [threadsError, setThreadsError] = useState('')
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null)
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((value) => value + 1)

  useEffect(() => {
    let active = true
    Promise.allSettled([getMessageriaStatus(), getErpStatus(), getGoogleIntegrationStatus(), getThreadsStatus()]).then(
      ([status, erpStatus, googleStatus, threadsStatus]) => {
        if (!active) return
        const messageriaStatus = status.status === 'fulfilled' ? status.value : null
        setMessageria(messageriaStatus)
        setErp(erpStatus.status === 'fulfilled' ? erpStatus.value : null)
        setGoogle(googleStatus.status === 'fulfilled' ? googleStatus.value : null)
        setThreads(threadsStatus.status === 'fulfilled' ? threadsStatus.value : null)
        setThreadsError(threadsStatus.status === 'rejected' ? (threadsStatus.reason instanceof Error ? threadsStatus.reason.message : 'Threads indisponível.') : '')
      },
    )
    return () => {
      active = false
    }
  }, [version])

  async function connectGoogle() {
    setFeedback(null)
    try {
      const { url } = await getGoogleAuthUrl()
      window.location.href = url
    } catch (error) {
      setFeedback({
        tone: error instanceof ApiError && error.code === 'google_not_configured' ? 'warning' : 'danger',
        text: error instanceof Error ? error.message : 'Não foi possível abrir o Google.',
      })
    }
  }

  async function toggleGoogle() {
    if (!google?.connected) return connectGoogle()
    if (!window.confirm('Desconectar o Google Agenda? As tarefas deixam de ir para a agenda.')) return
    try {
      await disconnectGoogleIntegration()
      setFeedback({ tone: 'success', text: 'Google Agenda desconectado.' })
      reload()
    } catch (error) {
      setFeedback({ tone: 'danger', text: error instanceof Error ? error.message : 'Não foi possível desconectar.' })
    }
  }

  const go = (page: Page) => () => navigate(page)
  const messageriaState: ConnectionState | null = messageria === null ? null : !messageria.connected ? 'disconnected' : messageria.erro ? 'error' : 'connected'
  const definition = (id: (typeof integrationDefinitions)[number]['id']) => integrationDefinitions.find((item) => item.id === id)!

  const items: Item[] = [
    { ...definition('threads'), icon: MessageCircle,
      state: threadsError ? 'error' : threads === null ? null : threads.connected ? 'connected' : 'disconnected', onOpen: () => setThreadsOpen(true), actionLabel: definition('threads').action },
    {
      ...definition('messageria'),
      icon: Send,
      state: messageriaState,
      onOpen: go('whatsapp-channel'),
      actionLabel: definition('messageria').action,
    },
    {
      ...definition('erp'),
      icon: Database,
      state: erp === null ? null : erp.connected ? 'connected' : 'disconnected',
      onOpen: () => setErpOpen(true),
      actionLabel: erp?.connected ? 'Gerenciar' : definition('erp').action,
    },
    {
      ...definition('google'),
      description: google?.connected && google.email ? `Tarefas na agenda de ${google.email}` : 'Tarefas e reuniões na sua agenda do Google',
      icon: Calendar,
      state: google === null ? null : google.connected ? 'connected' : 'disconnected',
      onOpen: () => void toggleGoogle(),
      actionLabel: google?.connected ? 'Desconectar' : definition('google').action,
    },
    {
      ...definition('n8n'),
      icon: Workflow,
      state: 'disconnected',
      stateLabel: definition('n8n').unavailableLabel,
      onOpen: go('automations'),
      actionLabel: definition('n8n').action,
    },
    {
      ...definition('pagamentos'),
      icon: CreditCard,
      state: 'soon',
      stateLabel: definition('pagamentos').unavailableLabel,
      actionLabel: definition('pagamentos').action,
    },
  ]
  const summary = connectionSummary(items.map((item) => item.state))

  return (
    <SettingsFrame page="integrations" title="Integrações" description="Canais trazem conversas; integrações trocam dados com outros sistemas da empresa." wide>
      <div className="space-y-4">
        <section aria-label="Resumo das integrações" className="grid grid-cols-2 gap-3 large:grid-cols-4">
          <SummaryCard value={summary.active} label="ativas" tone="text-emerald-700" />
          <SummaryCard value={summary.attention} label="precisam de atenção" tone="text-amber-700" />
          <SummaryCard value={summary.unavailable} label="indisponíveis" tone="text-slate-600" />
          <SummaryCard value={summary.loading} label="verificando" tone="text-blue-700" />
        </section>

        {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}

        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {items.map((item) => {
            const Icon = item.icon
            const content = (
              <>
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">{item.name}</span>
                  <span className="block text-sm leading-snug text-slate-500">{item.description}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {item.state ? <StatusBadge state={item.state} label={item.stateLabel} /> : <LoadingStatusBadge />}
                  {item.onOpen && <span className="hidden text-xs font-semibold text-blue-700 medium:inline">{item.actionLabel}</span>}
                </span>
              </>
            )
            return (
              <li key={item.id}>
                {item.onOpen ? (
                  <button type="button" onClick={item.onOpen} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50">
                    {content}
                  </button>
                ) : (
                  <div className="flex min-h-16 items-center gap-3 px-4 py-3">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {threadsOpen && <ThreadsSheet open onClose={() => setThreadsOpen(false)} status={threads} error={threadsError} onRefresh={reload} />}
      <ErpSheet
        open={erpOpen}
        status={erp}
        onClose={() => setErpOpen(false)}
        onChanged={(text) => {
          setFeedback({ tone: 'success', text })
          setErpOpen(false)
          reload()
        }}
      />
    </SettingsFrame>
  )
}

function SummaryCard({ value, label, tone }: { value: number; label: string; tone: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3"><strong className={`block text-2xl leading-none ${tone}`}>{value}</strong><span className="mt-1 block text-xs font-medium text-slate-600">{label}</span></div>
}

function ErpSheet({ open, status, onClose, onChanged }: { open: boolean; status: ErpStatus | null; onClose: () => void; onChanged: (message: string) => void }) {
  const [form, setForm] = useState({ baseUrl: 'https://erp.avilaops.com', apiKey: '', webhookSecret: '', erpTenantId: '', createMissingContacts: true, autoWinLeadOnOrder: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const webhookUrl = `${window.location.origin}/api/integrations/erp/webhook`

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectErp({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        webhookSecret: form.webhookSecret.trim(),
        erpTenantId: form.erpTenantId.trim(),
        settings: { createMissingContacts: form.createMissingContacts, autoWinLeadOnOrder: form.autoWinLeadOnOrder },
      })
      setForm((current) => ({ ...current, apiKey: '', webhookSecret: '' }))
      onChanged('ERP conectado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível conectar o ERP.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar o ERP? Os vínculos com os contatos ficam guardados para quando reconectar.')) return
    setBusy(true)
    try {
      await disconnectErp()
      onChanged('ERP desconectado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível desconectar.')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(status?.connected)

  return (
    <Sheet open={open} onClose={onClose} title="ERP Ávila Ops" description="Cliente, pedido e pagamento do ERP aparecem na linha do tempo do contato.">
      <div className="space-y-4 text-sm text-slate-700">
        {error && <Notice tone="danger">{error}</Notice>}
        {connected && status ? (
          <>
            <dl className="grid gap-2 rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-slate-500">Endereço</dt>
                <dd className="break-all font-medium text-slate-900">{status.baseUrl}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-slate-500">Eventos esperando processamento</dt>
                <dd className="font-medium text-slate-900">{status.pendingEvents}</dd>
              </div>
              {Object.entries(status.links).map(([entity, total]) => (
                <div key={entity} className="flex flex-wrap justify-between gap-2">
                  <dt className="text-slate-500">Vínculos de {entity}</dt>
                  <dd className="font-medium text-slate-900">{total}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className={buttonClass.danger} disabled={busy} onClick={disconnect}>
              {busy ? 'Desconectando…' : 'Desconectar o ERP'}
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <p>
              Gere uma chave de API e a assinatura de webhook no ERP, em Integrações › Chaves. No ERP, cadastre este endereço de entrega:
            </p>
            <code className="block break-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800">{webhookUrl}</code>
            <FormField label="Endereço do ERP">
              <input className="input" type="url" inputMode="url" autoCapitalize="none" required value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
            </FormField>
            <FormField label="Chave de API">
              <input className="input font-mono" type="password" autoComplete="off" spellCheck={false} required minLength={10} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
            </FormField>
            <FormField label="Segredo da assinatura de webhook">
              <input className="input font-mono" type="password" autoComplete="off" spellCheck={false} required minLength={10} value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} />
            </FormField>
            <FormField label="ID da conta no ERP" hint="O identificador (UUID) da empresa no ERP.">
              <input
                className="input font-mono"
                autoCapitalize="none"
                spellCheck={false}
                required
                pattern="[0-9a-fA-F-]{36}"
                value={form.erpTenantId}
                onChange={(event) => setForm({ ...form, erpTenantId: event.target.value })}
              />
            </FormField>
            <ToggleRow
              checked={form.createMissingContacts}
              onChange={(createMissingContacts) => setForm({ ...form, createMissingContacts })}
              title="Criar contato quando o ERP mandar um cliente novo"
            />
            <ToggleRow
              checked={form.autoWinLeadOnOrder}
              onChange={(autoWinLeadOnOrder) => setForm({ ...form, autoWinLeadOnOrder })}
              title="Fechar o negócio quando o pedido for confirmado"
              description="Desligado por padrão: nem todo pedido nasce de um negócio do funil."
            />
            <p className="text-xs text-slate-500">A chave e o segredo ficam cifrados no servidor e não voltam para o navegador.</p>
            <div>
              <button type="submit" className={buttonClass.primary} disabled={busy}>
                {busy ? 'Conectando…' : 'Conectar o ERP'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  )
}
