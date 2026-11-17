import { AtSign, ExternalLink, MessagesSquare, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Notice } from '../../components/ui/Form'
import { StatusBadge } from '../../components/ui/StatusBadge'
import {
  disconnectMetaMessaging,
  getMetaMessagingStatus,
  syncMetaMessaging,
  type MetaMessagingStatus,
} from '../../lib/omnichannel'
import { siteUrl } from '../../lib/seo'
import { buttonClass } from '../../lib/ui'
import { SettingsFrame } from './SettingsFrame'

type PageOption = { id: string; name: string }

export default function SocialChannelsPage() {
  const [status, setStatus] = useState<MetaMessagingStatus | null>(null)
  const [pages, setPages] = useState<PageOption[]>([])
  const [selectedPage, setSelectedPage] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = () => getMetaMessagingStatus().then(setStatus).catch((caught: Error) => setError(caught.message))
  useEffect(() => { void load() }, [])

  async function sync(pageId?: string) {
    setBusy('sync')
    setError('')
    setMessage('')
    try {
      const result = await syncMetaMessaging(pageId)
      if ('selectionRequired' in result) {
        setPages(result.pages)
        setSelectedPage(result.pages[0]?.id ?? '')
        setMessage('Escolha qual Página será usada por esta empresa.')
        return
      }
      setPages([])
      setSelectedPage('')
      setMessage('Conta Meta sincronizada. Instagram e Messenger já podem entregar conversas à Caixa de entrada.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível sincronizar a conta Meta.')
    } finally {
      setBusy('')
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar Instagram e Messenger desta empresa?')) return
    setBusy('disconnect')
    setError('')
    try {
      await disconnectMetaMessaging()
      setMessage('Canais desconectados. O histórico foi preservado.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível desconectar.')
    } finally {
      setBusy('')
    }
  }

  const connectUrl = status?.connectUrl ?? 'https://auth.avilaops.com/conta/meta'

  return (
    <SettingsFrame page="social-channel" title="Instagram e Messenger" description="Um administrador autoriza a conta Meta da empresa; toda a equipe atende pelos mesmos canais.">
      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}

        {status?.channels.length ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="font-semibold text-slate-900">Canais desta empresa</h2><p className="text-sm text-slate-500">Autorizado por • {status.account ?? 'Conta Avila Ops'}</p></div>
              <button type="button" className={buttonClass.secondary} onClick={() => void load()}><RefreshCw size={16} />Atualizar</button>
            </div>
            <ul className="divide-y divide-slate-100">
              {status.channels.map((channel) => (
                <li key={channel.id} className="flex min-h-14 items-center gap-3 py-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-slate-100 text-slate-700">{channel.provider === 'instagram' ? <AtSign size={18} /> : <MessagesSquare size={18} />}</span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{channel.display_name}</strong><span className="text-xs capitalize text-slate-500">{channel.provider}</span></span>
                  <StatusBadge state={channel.status === 'connected' ? 'connected' : channel.error_message ? 'error' : 'disconnected'} />
                </li>
              ))}
            </ul>
            <button type="button" className={`${buttonClass.secondary} mt-4 text-red-700`} disabled={busy === 'disconnect'} onClick={() => void disconnect()}><Unplug size={16} />{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar desta empresa'}</button>
          </section>
        ) : null}

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="font-semibold text-slate-900">Conectar com OAuth</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Entre na Conta Avila Ops, autorize os ativos da empresa na Meta e volte para sincronizar. Tokens e segredos nunca são digitados ou exibidos no CRM.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a className={buttonClass.primary} href={connectUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={16} />Autorizar na Conta Avila Ops</a>
            <button type="button" className={buttonClass.secondary} disabled={busy === 'sync'} onClick={() => void sync()}><RefreshCw size={16} />{busy === 'sync' ? 'Sincronizando…' : 'Já autorizei • sincronizar'}</button>
          </div>

          {pages.length > 0 && (
            <div className="space-y-3 rounded-lg bg-slate-50 p-4">
              <label className="block text-sm font-medium text-slate-800" htmlFor="meta-page">Página usada por esta empresa</label>
              <select id="meta-page" className="input" value={selectedPage} onChange={(event) => setSelectedPage(event.target.value)}>
                {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select>
              <button type="button" className={buttonClass.primary} disabled={!selectedPage || busy === 'sync'} onClick={() => void sync(selectedPage)}>Conectar Página selecionada</button>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><strong className="block text-slate-800">URL pública do webhook</strong><code className="break-all">{`${siteUrl}/webhooks/meta/messaging`}</code></div>
        </section>
      </div>
    </SettingsFrame>
  )
}
