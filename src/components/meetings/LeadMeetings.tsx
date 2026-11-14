'use client'

import { useEffect, useState } from 'react'
import { Video } from 'lucide-react'
import { guestLink, meetingPost, meetingRequest, verdictLabel, type Meeting } from '../../lib/meetings'
import MeetingReport from './MeetingReport'

export default function LeadMeetings({ leadId }: { leadId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    meetingRequest<{ configured: boolean; meetings: Meeting[] }>(`/api/leads/${leadId}/meetings`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setConfigured(result.configured); setMeetings(result.meetings); setError('') } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [leadId, reload])
  const create = async () => {
    setBusy(true)
    try { const result = await meetingPost<{ meeting: Meeting; inviteToken: string }>(`/api/leads/${leadId}/meetings`); setMeetings(items => [result.meeting, ...items]); setLink(guestLink(result.meeting.id, result.inviteToken)); setCopied(false); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao criar reunião.') }
    finally { setBusy(false) }
  }
  const invite = async (id: string) => {
    setBusy(true)
    try { const result = await meetingPost<{ inviteToken: string }>(`/api/meetings/${id}/invite`); setLink(guestLink(id, result.inviteToken)); setCopied(false); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Falha ao gerar convite.') }
    finally { setBusy(false) }
  }
  return <section className="space-y-4 border-t border-slate-200 pt-4" aria-label="Videochamadas do lead">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Video size={18} />Videochamadas e avaliação</h3><button onClick={() => void create()} disabled={busy || !configured} className="min-h-11 rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Aguarde…' : 'Nova videochamada'}</button></div>
    <p className="text-sm leading-6 text-slate-500">Converse com o lead e receba a transcrição, o resumo e uma avaliação dos critérios comerciais.</p>
    {configured === false && <p className="text-sm text-amber-800">O serviço de reuniões precisa ser configurado por um administrador.</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}<button onClick={() => setReload(n => n + 1)} className="ml-2 underline">Atualizar lista</button></p>}
    {link && <div className="space-y-2 rounded-lg bg-blue-50 p-3"><label className="block text-sm font-semibold">Link do convidado<input aria-label="Link do convidado" value={link} readOnly onFocus={e => e.currentTarget.select()} className="mt-2 min-h-11 w-full rounded border bg-white px-2 text-xs font-normal" /></label><button onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError('Selecione e copie o link acima.')) }} className="min-h-11 text-sm font-semibold text-blue-700">{copied ? 'Link copiado' : 'Copiar convite'}</button><p className="text-xs text-slate-600">Válido por 24 horas ou até encerrar a reunião. Compartilhe somente com o convidado.</p></div>}
    {!meetings.length && configured && <p className="text-sm text-slate-500">Nenhuma reunião vinculada ainda.</p>}
    {meetings.map(meeting => <article key={meeting.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div><p className="text-sm font-semibold">{new Date(meeting.created_at).toLocaleString('pt-BR')}</p><p className="mt-1 text-xs text-slate-500">{meeting.status === 'ended' ? meeting.assessment ? verdictLabel[meeting.assessment.verdict] : 'Encerrada • avaliação pendente' : meeting.status === 'active' ? 'Em andamento' : 'Pronta para iniciar'}</p></div>
      <div className="flex flex-wrap gap-3 text-sm">{meeting.status !== 'ended' && <><a href={`/meet/${meeting.id}/`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-semibold text-blue-700">Entrar na reunião</a><button disabled={busy} onClick={() => void invite(meeting.id)} className="min-h-11 text-blue-700">Novo convite</button></>}
        <button onClick={() => setExpanded(value => value === meeting.id ? null : meeting.id)} className="min-h-11 text-slate-700">{expanded === meeting.id ? 'Recolher histórico' : 'Ver histórico'}</button>
      </div>{expanded === meeting.id && <><MeetingReport id={meeting.id} />{meeting.status !== 'ended' && <button disabled={busy} onClick={() => { setBusy(true); void meetingPost(`/api/meetings/${meeting.id}/end`, { captureComplete: false }).then(() => setReload(n => n + 1)).catch(e => setError(e.message)).finally(() => setBusy(false)) }} className="min-h-11 text-sm text-red-700">Encerrar reunião interrompida</button>}</>}
    </article>)}
  </section>
}
