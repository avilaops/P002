'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Plus, Send, Sparkles, X } from 'lucide-react'
import { sendCopilotMessage } from '../../lib/ai'
import { ApiError } from '../../lib/crm'
import type { CopilotMessage, CopilotSource } from '../../lib/copilot'

type ChatMessage = CopilotMessage & { sources?: CopilotSource[] }

function Copilot() {
  const inputId = useId()
  const [collapsed, setCollapsed] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const conversation = useRef<HTMLDivElement>(null)

  useEffect(() => () => { active.current?.abort() }, [])
  useEffect(() => {
    if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight
  }, [messages, busy, error, collapsed])

  function newChat() {
    generation.current++
    active.current?.abort()
    active.current = null
    setBusy(false)
    setMessages([])
    setDraft('')
    setError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (active.current || !content || content.length > 2000) return
    const controller = new AbortController()
    const requestId = ++generation.current
    const previous = messages
    const next: ChatMessage[] = [...messages, { role: 'user', content }]
    active.current = controller
    setMessages(next)
    setDraft('')
    setError(null)
    setBusy(true)
    try {
      const result = await sendCopilotMessage(next, controller.signal)
      if (requestId !== generation.current || controller.signal.aborted) return
      setMessages([...next, { ...result.message, sources: result.sources }])
    } catch (failure) {
      if (requestId !== generation.current) return
      setMessages(previous)
      setDraft(content)
      if (!controller.signal.aborted) {
        setError(failure instanceof ApiError ? failure.message : 'Não foi possível conectar à IA. Tente novamente.')
      }
    } finally {
      if (requestId === generation.current) {
        active.current = null
        setBusy(false)
      }
    }
  }

  if (collapsed) return (
    <aside className="sticky top-0 hidden h-dvh w-12 shrink-0 border-l border-slate-200 bg-white xl:block">
      <button type="button" onClick={() => setCollapsed(false)} aria-label="Abrir Copiloto" title="Abrir Copiloto" className="grid h-16 w-full place-items-center text-violet-600 focus-visible:outline-2 focus-visible:outline-violet-500">
        <Sparkles size={18} aria-hidden="true" />
      </button>
    </aside>
  )

  return (
    <aside aria-label="Copiloto Ávila CRM" className="sticky top-0 hidden h-dvh w-80 shrink-0 flex-col border-l border-slate-200 bg-white xl:flex">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
        <h2 className="font-medium"><Sparkles className="mr-2 inline text-violet-500" size={16} aria-hidden="true" />Copilot Ávila CRM</h2>
        <button type="button" onClick={() => setCollapsed(true)} aria-label="Recolher Copiloto" className="rounded p-1 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-violet-500"><X size={16} aria-hidden="true" /></button>
      </div>
      <button type="button" onClick={newChat} className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4 text-left text-sm hover:bg-slate-50">Novo chat <Plus size={16} aria-hidden="true" /></button>
      <div ref={conversation} role="log" aria-label="Conversa com o Copiloto" aria-live="polite" aria-relevant="additions text" className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && <div className="px-1 text-center">
          <div className="mx-auto mt-12 grid h-10 w-10 place-items-center rounded bg-violet-100 text-violet-600"><Sparkles size={18} aria-hidden="true" /></div>
          <h3 className="mt-5 font-semibold">Modo Ajuda</h3>
          <p className="mx-auto mt-2 max-w-xs text-sm text-slate-500">Tire dúvidas sobre o CRM, peça ajuda para escrever e consulte as fontes de conhecimento da sua empresa.</p>
        </div>}
        <ol className="space-y-4">
          {messages.map((message, index) => <li key={index} className={`rounded-xl px-3 py-3 text-sm ${message.role === 'user' ? 'ml-5 bg-violet-50 text-slate-900' : 'mr-2 border border-slate-100 bg-slate-50 text-slate-800'}`}>
            <p className="mb-1 text-xs font-semibold text-slate-500">{message.role === 'user' ? 'Você' : 'Copiloto'}</p>
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {Boolean(message.sources?.length) && <div className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
              <p className="font-medium">Fontes consultadas</p>
              <ul className="mt-1 space-y-1">{message.sources?.map(source => <li key={source.id} className="break-words">{source.title}</li>)}</ul>
            </div>}
          </li>)}
        </ol>
        {busy && <div role="status" className="mt-4 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Preparando resposta…</div>}
        {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>
      <form onSubmit={submit} className="shrink-0 border-t border-slate-200 p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <label htmlFor={inputId} className="font-medium text-slate-700">Mensagem para o Copiloto</label>
          {busy && <button type="button" onClick={() => active.current?.abort()} className="underline underline-offset-2">Cancelar resposta</button>}
        </div>
        <textarea id={inputId} value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={busy} rows={3} className="input w-full resize-none disabled:opacity-60" placeholder="Pergunte ao Copilot Ávila CRM" onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} />
        <button type="submit" disabled={busy || !draft.trim()} className="mt-2 w-full rounded bg-slate-950 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"><Send className="mr-2 inline" size={14} aria-hidden="true" />{busy ? 'Aguardando resposta' : 'Enviar'}</button>
        <p className="mt-3 text-center text-xs text-slate-400">O conteúdo gerado por IA pode ser impreciso</p>
      </form>
    </aside>
  )
}

export default Copilot

