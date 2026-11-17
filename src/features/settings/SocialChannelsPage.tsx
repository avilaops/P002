import { AtSign, MessagesSquare, RefreshCw, Unplug } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { FormField, FormSection, Notice } from '../../components/ui/Form'
import { StatusBadge } from '../../components/ui/StatusBadge'
import {
  disconnectMetaMessaging,
  getMetaMessagingStatus,
  saveMetaMessaging,
  type MetaMessagingStatus,
} from '../../lib/omnichannel'
import { buttonClass } from '../../lib/ui'
import { siteUrl } from '../../lib/seo'
import { SettingsFrame } from './SettingsFrame'

const EMPTY = { pageId: '', pageName: '', instagramId: '', instagramName: '', accessToken: '', appSecret: '', verifyToken: '' }

export default function SocialChannelsPage() {
  const [status, setStatus] = useState<MetaMessagingStatus | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = () => getMetaMessagingStatus().then(setStatus).catch((caught: Error) => setError(caught.message))
  useEffect(() => { void load() }, [])

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy('save')
    setError('')
    try {
      await saveMetaMessaging(form)
      setForm(EMPTY)
      setMessage('Instagram e Messenger conectados. O webhook já pode entregar mensagens à Caixa de entrada.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a conexão.')
    } finally {
      setBusy('')
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar Instagram e Messenger desta empresa?')) return
    setBusy('disconnect')
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

  return (
    <SettingsFrame page="social-channel" title="Instagram e Messenger" description="Mensagens diretas e conversas da página entram na mesma Caixa de entrada do CRM.">
      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}

        {status?.channels.length ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="font-semibold text-slate-900">Canais conectados</h2><p className="text-sm text-slate-500">Conta • {status.account ?? 'Meta'}</p></div>
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
            <button type="button" className={`${buttonClass.secondary} mt-4 text-red-700`} disabled={busy === 'disconnect'} onClick={() => void disconnect()}><Unplug size={16} />{busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}</button>
          </section>
        ) : null}

        <form className="space-y-5" onSubmit={save}>
          <FormSection title={status?.connected ? 'Atualizar credenciais' : 'Conectar conta Meta'} description="Use um token de Página com permissões de mensagens. Os segredos ficam criptografados e nunca voltam para o navegador.">
            <div className="grid gap-4 medium:grid-cols-2">
              <FormField label="ID da Página"><input className="input" value={form.pageId} onChange={set('pageId')} required /></FormField>
              <FormField label="Nome da Página"><input className="input" value={form.pageName} onChange={set('pageName')} required /></FormField>
              <FormField label="ID da conta Instagram • opcional"><input className="input" value={form.instagramId} onChange={set('instagramId')} /></FormField>
              <FormField label="Nome do Instagram • opcional"><input className="input" value={form.instagramName} onChange={set('instagramName')} /></FormField>
            </div>
          </FormSection>
          <FormSection title="Credenciais e webhook">
            <div className="space-y-4">
              <FormField label="Token de acesso"><input className="input" type="password" autoComplete="new-password" value={form.accessToken} onChange={set('accessToken')} required /></FormField>
              <div className="grid gap-4 medium:grid-cols-2">
                <FormField label="App Secret"><input className="input" type="password" autoComplete="new-password" value={form.appSecret} onChange={set('appSecret')} required /></FormField>
                <FormField label="Token de verificação"><input className="input" type="password" autoComplete="new-password" value={form.verifyToken} onChange={set('verifyToken')} minLength={16} required /></FormField>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><strong className="block text-slate-800">URL do webhook</strong><code className="break-all">{`${siteUrl}/webhooks/meta/messaging`}</code></div>
            </div>
          </FormSection>
          <button type="submit" className={buttonClass.primary} disabled={busy === 'save'}>{busy === 'save' ? 'Salvando…' : status?.connected ? 'Atualizar conexão' : 'Conectar canais'}</button>
        </form>
      </div>
    </SettingsFrame>
  )
}
