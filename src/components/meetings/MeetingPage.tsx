'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveKitRoom } from '@livekit/components-react'
import '@livekit/components-styles'
import { meetingPost, meetingRequest, type MeetingDetail, type RoomEntry } from '../../lib/meetings'
import MeetingCapture from './MeetingCapture'
import MeetingReport from './MeetingReport'
import MeetingConference from './MeetingConference'

export default function MeetingPage() {
  const [id, setId] = useState('')
  const [invite, setInvite] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [entry, setEntry] = useState<RoomEntry | null>(null)
  const [detail, setDetail] = useState<MeetingDetail | null>(null)
  const [error, setError] = useState('')
  const [captureIssue, setCaptureIssue] = useState(false)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState(false)
  const finishing = useRef(false)
  const broken = useRef(false)
  const flush = useRef<(() => Promise<boolean>) | null>(null)
  useEffect(() => {
    const meetingId = window.location.pathname.split('/')[2] ?? ''
    if (!/^[\da-f-]{36}$/i.test(meetingId)) { setError('Endereço de reunião inválido.'); return }
    setId(meetingId)
    const token = new URLSearchParams(window.location.hash.slice(1)).get('invite')
    setInvite(token)
    if (!token) {
      const controller = new AbortController()
      meetingRequest<MeetingDetail>(`/api/meetings/${meetingId}`, { signal: controller.signal }).then(setDetail).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      return () => controller.abort()
    }
  }, [])
  const issue = useCallback(() => {
    if (broken.current) return
    broken.current = true; setCaptureIssue(true)
    if (id) void meetingPost(`/api/meetings/${id}/capture-error`).catch(() => {})
  }, [id])
  const ready = useCallback((stop: () => Promise<boolean>) => { flush.current = stop }, [])
  useEffect(() => {
    if (entry?.role !== 'host') return
    const warn = (event: BeforeUnloadEvent) => { if (!finishing.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [entry])
  const join = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este navegador precisa de câmera e microfone em uma conexão HTTPS ou localhost.')
      const result = await meetingPost<RoomEntry>(`/api/meetings/${id}/join`, { consent, ...(invite ? { inviteToken: invite, name } : {}) })
      finishing.current = false; setLeft(false); setEntry(result)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar na sala.') }
    finally { setBusy(false) }
  }
  const end = async () => {
    setBusy(true); finishing.current = true
    try {
      const complete = flush.current ? await flush.current() : false
      await meetingPost(`/api/meetings/${id}/end`, { captureComplete: complete && !broken.current })
      setEntry(null); setLeft(true)
      const next = await meetingRequest<MeetingDetail>(`/api/meetings/${id}`); setDetail(next); setError('')
    } catch (e) { finishing.current = false; issue(); setError(e instanceof Error ? e.message : 'Não foi possível encerrar a reunião. Tente novamente.') }
    finally { setBusy(false) }
  }
  const disconnected = () => {
    if (finishing.current) return
    if (entry?.role === 'host') { issue(); setError('A chamada foi interrompida. Você pode entrar novamente ou encerrá-la no histórico do lead.') }
    setEntry(null); setLeft(true)
  }
  const ended = detail?.meeting.status === 'ended'
  return <main className="min-h-dvh bg-slate-950 text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><p className="text-sm font-semibold">Ávila CRM • Reunião</p><p className="mt-1 text-xs text-slate-400">Vídeo, conversa e acompanhamento por IA</p></div>{!invite && <a href="/leads/list/" className="text-sm text-blue-300">Voltar ao CRM</a>}</header>
    {entry ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-5 py-3"><p className="text-sm">A conversa está sendo transcrita com IA.</p>{entry.role === 'host' && <button disabled={busy} onClick={() => void end()} className="min-h-11 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Salvando e encerrando…' : 'Encerrar e avaliar reunião'}</button>}</div>
      {error && <p role="alert" className="bg-red-950 p-4 text-sm text-red-100">{error}</p>}
      {captureIssue && <p role="alert" className="bg-amber-950 p-4 text-sm text-amber-100">A captura teve uma interrupção. A reunião continua, e a avaliação indicará a informação incompleta.</p>}
      <LiveKitRoom token={entry.token} serverUrl={entry.url} audio video connect options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={disconnected} onError={() => setError('Não foi possível conectar o vídeo. Verifique o serviço e as permissões de câmera e microfone.')}
        onMediaDeviceFailure={(_failure, kind) => { setError('Câmera ou microfone indisponível. Confira as permissões do navegador.'); if (entry.role === 'host' && kind !== 'videoinput') issue() }}
        data-lk-theme="default" style={{ height: 'min(76dvh, 850px)', minHeight: 420, display: 'flex', flexDirection: 'column' }}>
        {entry.role === 'host' && <MeetingCapture id={id} startedAt={entry.startedAt} onReady={ready} onIssue={issue} />}
        <MeetingConference guest={entry.role === 'guest'} />
      </LiveKitRoom>
      {entry.role === 'host' && <p className="px-5 py-4 text-xs text-slate-400">Use “Encerrar e avaliar reunião” para salvar os últimos trechos e iniciar a avaliação. A transcrição depende de você permanecer na sala.</p>}
    </> : <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <section className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-2xl font-semibold">{ended ? 'Reunião encerrada' : left && invite ? 'Você saiu da reunião' : 'Entre na conversa'}</h1>
        {error && <p role="alert" className="rounded-lg bg-red-950 p-3 text-sm text-red-100">{error}</p>}
        {!ended && id && <form onSubmit={e => void join(e)} className="space-y-5">
          {invite ? <label className="block text-sm">Seu nome<input autoComplete="name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} className="mt-2 min-h-12 w-full rounded-lg border border-slate-600 bg-slate-800 px-3" /></label> : <p className="text-sm text-slate-300">Entre com a sua sessão do CRM para conduzir esta reunião.</p>}
          <p className="text-sm leading-6 text-slate-300">O áudio será transcrito para registrar a conversa, gerar um resumo e avaliar os critérios comerciais. O histórico fica disponível à equipe responsável no CRM.</p>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700 p-4 text-sm leading-6"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required className="mt-1 size-4 shrink-0" /><span>Estou ciente e autorizo a transcrição e análise desta conversa por IA.</span></label>
          <button disabled={!consent || busy || (!invite && !detail?.canHost)} className="min-h-12 w-full rounded-lg bg-blue-600 px-5 font-semibold disabled:opacity-50">{busy ? 'Preparando sala…' : 'Entrar na videochamada'}</button>
          <p className="text-xs leading-5 text-slate-400">O navegador solicitará acesso à câmera e ao microfone. Você pode desligá-los durante a conversa.</p>
        </form>}
      </section>
      {!invite && id && detail && <div className="rounded-2xl bg-slate-50 p-5 text-slate-900"><MeetingReport id={id} /></div>}
    </div>}
  </main>
}
