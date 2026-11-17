import { Check, Copy, Globe } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { FormField, FormSection, Notice } from '../../components/ui/Form'
import { getWebChatChannel, saveWebChatChannel } from '../../lib/omnichannel'
import { buttonClass } from '../../lib/ui'
import { SettingsFrame } from './SettingsFrame'

export default function WebChatChannelPage() {
  const [form, setForm] = useState({ name: 'Chat do site', origins: '', brandColor: '#2563eb', welcomeMessage: 'Olá! Como podemos ajudar?' })
  const [embedCode, setEmbedCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    getWebChatChannel().then(({ channel, embedCode: code }) => {
      if (!channel) return
      setForm({
        name: channel.display_name,
        origins: channel.metadata.allowedOrigins?.join('\n') ?? '',
        brandColor: channel.metadata.brandColor ?? '#2563eb',
        welcomeMessage: channel.metadata.welcomeMessage ?? 'Olá! Como podemos ajudar?',
      })
      setEmbedCode(code ?? '')
    }).catch((caught: Error) => setError(caught.message))
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await saveWebChatChannel({
        name: form.name,
        allowedOrigins: form.origins.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
        brandColor: form.brandColor,
        welcomeMessage: form.welcomeMessage,
      })
      setEmbedCode(result.embedCode)
      setMessage('Chat configurado. Copie o código para o site autorizado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível configurar o chat.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(embedCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <SettingsFrame page="webchat-channel" title="Chat do site" description="Adicione um botão de atendimento ao seu site e responda pela Caixa de entrada.">
      <form className="space-y-5" onSubmit={save}>
        {error && <Notice tone="danger">{error}</Notice>}
        {message && <Notice tone="success">{message}</Notice>}
        <FormSection title="Aparência e mensagem">
          <div className="grid gap-4 medium:grid-cols-[minmax(0,1fr)_9rem]">
            <FormField label="Nome do canal"><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></FormField>
            <FormField label="Cor"><input className="input h-11" type="color" value={form.brandColor} onChange={(event) => setForm({ ...form, brandColor: event.target.value })} /></FormField>
          </div>
          <FormField label="Mensagem de boas-vindas"><textarea className="input min-h-24" value={form.welcomeMessage} maxLength={500} onChange={(event) => setForm({ ...form, welcomeMessage: event.target.value })} /></FormField>
        </FormSection>
        <FormSection title="Sites autorizados" description="Uma origem por linha, incluindo https. Use * somente se o widget realmente puder aparecer em qualquer site.">
          <FormField label="Origens"><textarea className="input min-h-28 font-mono text-sm" placeholder={'https://www.suaempresa.com.br\nhttps://loja.suaempresa.com.br'} value={form.origins} onChange={(event) => setForm({ ...form, origins: event.target.value })} required /></FormField>
        </FormSection>
        <button type="submit" className={buttonClass.primary} disabled={busy}><Globe size={16} />{busy ? 'Salvando…' : 'Salvar configuração'}</button>

        {embedCode && (
          <FormSection title="Código de instalação" description="Cole antes do fechamento de </body> em todas as páginas que devem mostrar o chat.">
            <div className="rounded-lg bg-slate-950 p-4 text-sm text-slate-100"><code className="break-all">{embedCode}</code></div>
            <button type="button" className={buttonClass.secondary} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copiado' : 'Copiar código'}</button>
          </FormSection>
        )}
      </form>
    </SettingsFrame>
  )
}
