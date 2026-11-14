'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, LoaderCircle, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { ApiError } from '../../lib/crm'
import { requestEvolution, EvolutionTimeoutError } from '../../lib/evolution'
import { evolutionPairingView, nextEvolutionAction, QR_REFRESH_MS, type EvolutionAction, type EvolutionStatus } from '../../lib/evolutionPairing'

export function EvolutionCard({ canManage = false }: { canManage?: boolean }) {
  const titleId = useId()
  const [status, setStatus] = useState<EvolutionStatus | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [operation, setOperation] = useState<EvolutionAction | null>(null)
  const [clock, setClock] = useState(0)
  const latest = useRef<EvolutionStatus | null>(null)
  const latestQr = useRef<string | null>(null)
  const lastStatusAt = useRef(0)
  const lastQrAt = useRef(0)
  const failed = useRef(false)
  const active = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const run = useCallback(async (action: EvolutionAction) => {
    if (!mounted.current || active.current || (action !== 'status' && !canManage)) return
    const controller = new AbortController()
    active.current = controller
    setOperation(action)
    if (action !== 'status') setNotice('')
    try {
      if (action === 'sync') {
        const result = await requestEvolution<{ imported: number }>('sync', controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        setNotice(result.imported === 0 ? 'Nenhuma mensagem nova neste momento.' : `${result.imported} ${result.imported === 1 ? 'mensagem nova sincronizada' : 'mensagens novas sincronizadas'}.`)
      } else {
        const next = await requestEvolution<EvolutionStatus>(action, controller.signal)
        if (controller.signal.aborted || !mounted.current) return
        if (!['connected', 'connecting', 'disconnected'].includes(next.state)) throw new Error('invalid status')
        latest.current = next
        setStatus(next)
        lastStatusAt.current = Date.now()
        if (action === 'connect' || next.state !== 'connecting') {
          const code = next.state === 'connecting' ? next.qrCode ?? null : null
          latestQr.current = code
          setQr(code)
          lastQrAt.current = Date.now()
          setClock(Date.now())
        }
      }
      failed.current = false
      setError('')
    } catch (failure) {
      if (controller.signal.aborted || !mounted.current) return
      failed.current = true
      latestQr.current = null
      setQr(null)
      setError(failure instanceof EvolutionTimeoutError ? failure.message : failure instanceof ApiError && failure.status === 403
        ? 'Seu acesso permite acompanhar a conexão. Para parear o aparelho, peça ajuda a um administrador ou gerente.'
        : failure instanceof ApiError && failure.status === 503
          ? 'A conexão do WhatsApp ainda precisa ser preparada para esta empresa. Peça ajuda a um administrador.'
          : action === 'sync' ? 'Não foi possível sincronizar agora. Verifique a conexão e tente novamente.'
            : 'Não conseguimos confirmar a conexão agora. Verifique se o serviço está disponível e tente novamente.')
    } finally {
      if (active.current === controller) {
        active.current = null
        lastStatusAt.current = Date.now()
        if (action === 'connect') lastQrAt.current = Date.now()
        if (mounted.current) setOperation(null)
      }
    }
  }, [canManage])

  useEffect(() => {
    mounted.current = true
    if (!canManage) { latestQr.current = null; setQr(null) }
    const update = () => {
      const now = Date.now()
      if (latestQr.current && document.visibilityState === 'visible') setClock(now)
      const action = nextEvolutionAction({
        state: latest.current?.state ?? null, canManage, hasQr: Boolean(latestQr.current), hasError: failed.current,
        visible: document.visibilityState === 'visible', pending: Boolean(active.current), now,
        lastStatusAt: lastStatusAt.current, lastQrAt: lastQrAt.current,
      })
      if (action) void run(action)
    }
    update()
    const timer = setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    return () => {
      mounted.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      active.current?.abort()
      active.current = null
    }
  }, [canManage, run])

  const preparing = operation === 'connect' && status?.state !== 'connected'
  const displayed = preparing && !qr ? { state: 'connecting' as const, phone: null, instanceName: status?.instanceName ?? '' } : status
  const view = evolutionPairingView(displayed, qr, error)
  const busy = operation !== null
  const remaining = Math.max(0, Math.ceil((QR_REFRESH_MS - (clock - lastQrAt.current)) / 1000))
  const connected = view.state === 'connected'
  const waiting = view.state === 'waiting' || view.state === 'preparing'
  const badge = connected ? 'Conectado' : view.state === 'checking' ? 'Verificando' : waiting ? 'Pareamento em andamento' : view.state === 'error' ? 'Verificação necessária' : 'Não conectado'

  return <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 medium:p-6" aria-labelledby={titleId}>
    <header className="flex items-start gap-3">
      <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
        {connected ? <CheckCircle2 size={24} aria-hidden="true" /> : <Smartphone size={24} aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <p role="status" aria-live="polite" className={`text-xs font-semibold ${connected ? 'text-emerald-700' : view.state === 'error' ? 'text-red-700' : 'text-slate-500'}`}>{badge}</p>
        <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-900">{!canManage && waiting ? 'Aguardando pareamento' : view.title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{connected ? view.phone ? `Número vinculado: ${view.phone}` : 'Seu aparelho está vinculado à empresa.' : 'Uma conexão para toda a equipe. Você acompanha o pareamento por aqui.'}</p>
      </div>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</div>}
    {view.state === 'checking' && <p className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Consultando seu WhatsApp…</p>}
    {view.state === 'preparing' && canManage && <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><LoaderCircle size={20} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /><p>O código aparecerá aqui assim que estiver pronto. Não é necessário clicar novamente.</p></div>}
    {view.showQr && canManage && qr && <div className="grid gap-5 medium:grid-cols-[minmax(0,260px)_minmax(0,1fr)] medium:items-center">
      <div className="grid justify-items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <img src={qr} alt="QR Code para vincular o WhatsApp da empresa" width={260} height={260} className="h-auto max-w-full" />
        <p className="text-center text-xs text-slate-500">{operation === 'connect' ? 'Atualizando código…' : `Atualização automática em ${remaining} s`}</p>
      </div>
      <div>
        <h3 className="font-semibold text-slate-900">No seu celular</h3>
        <ol className="mt-4 space-y-4 text-sm leading-6 text-slate-600">
          <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800" aria-hidden="true">1</span><span>Abra o <strong>WhatsApp</strong>.</span></li>
          <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800" aria-hidden="true">2</span><span>Em <strong>Configurações</strong> ou no menu <strong>⋮</strong>, escolha <strong>Aparelhos conectados</strong>.</span></li>
          <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800" aria-hidden="true">3</span><span>Toque em <strong>Conectar aparelho</strong> e aponte a câmera para este código.</span></li>
        </ol>
        <p className="mt-5 text-sm font-medium text-emerald-800">A confirmação aparecerá aqui automaticamente.</p>
      </div>
    </div>}
    {!canManage && !connected && <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Você pode acompanhar o status desta conexão. Um administrador ou gerente precisa gerar o QR Code e parear o aparelho.</p>}
    {connected && <p className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">Tudo certo com o vínculo do aparelho. Abra a caixa de entrada para acompanhar suas conversas.</p>}
    {notice && <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      {connected && <a href="/communications/inbox/" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white">Abrir caixa de entrada<ArrowRight size={16} aria-hidden="true" /></a>}
      {canManage && !connected && view.state !== 'checking' && <button type="button" onClick={() => void run('connect')} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {operation === 'connect' ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <QrCode size={16} aria-hidden="true" />}{operation === 'connect' ? 'Preparando código…' : view.showQr ? 'Atualizar código agora' : 'Gerar QR Code'}
      </button>}
      {view.state !== 'checking' && <button type="button" onClick={() => void run('status')} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"><RefreshCw size={16} className={operation === 'status' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />{operation === 'status' ? 'Verificando…' : 'Atualizar status'}</button>}
      {canManage && connected && <button type="button" onClick={() => void run('sync')} disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 disabled:opacity-50">{operation === 'sync' ? 'Sincronizando…' : 'Sincronizar mensagens'}</button>}
    </div>
    <p className="border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">A sincronização deste canal inclui mensagens recentes de texto. Grupos e anexos não são importados por esta conexão.</p>
  </section>
}
