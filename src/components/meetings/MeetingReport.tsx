'use client'

import { useEffect, useId, useState } from 'react'
import { criterionLabel, meetingPost, meetingRequest, verdictLabel, type MeetingDetail, type Verdict } from '../../lib/meetings'

export default function MeetingReport({ id }: { id: string }) {
  const formId = useId()
  const [detail, setDetail] = useState<MeetingDetail | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [verdict, setVerdict] = useState<Verdict>('insufficient_data')
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let pending = false
    const load = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try { const next = await meetingRequest<MeetingDetail>(`/api/meetings/${id}`, { signal: controller.signal }); if (!controller.signal.aborted) { setDetail(next); setError('') } }
      catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Falha ao consultar reunião.') }
      finally { pending = false }
    }
    void load(); const timer = setInterval(() => void load(), 4000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [id, reload])
  const action = async (name: string, body = {}) => {
    setSaving(true)
    try { await meetingPost(`/api/meetings/${id}/${name}`, body); setReload(n => n + 1); if (name === 'review') setNote(''); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.') }
    finally { setSaving(false) }
  }
  const assessment = detail?.meeting.assessment
  const pending = detail?.segments.filter(s => ['queued', 'processing'].includes(s.status)).length ?? 0
  const failed = detail?.segments.filter(s => s.status === 'failed').length ?? 0
  return <section className="space-y-4 text-sm" aria-label="Histórico da reunião">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {!detail && !error && <p role="status">Carregando reunião…</p>}
    {detail && <>
      {detail.meeting.capture_incomplete && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Houve uma interrupção na captura. A avaliação precisa de revisão.</p>}
      {pending > 0 && <p role="status" className="text-slate-600">{pending} trecho(s) aguardando transcrição. Você pode acompanhar por aqui.</p>}
      {failed > 0 && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{failed} trecho(s) não foram transcritos. A avaliação considera essa falta de informação.</p>}
      {detail.meeting.analysis_status === 'queued' && <p role="status">A avaliação começará após as transcrições pendentes.</p>}
      {detail.meeting.analysis_status === 'processing' && <p role="status">A IA está avaliando a conversa. Isso pode levar alguns minutos.</p>}
      {detail.meeting.analysis_error && <p role="alert" className="text-red-800">{detail.meeting.analysis_error}</p>}
      {detail.canHost && (failed > 0 || detail.meeting.analysis_status === 'failed') && <button disabled={saving} onClick={() => void action('retry')} className="min-h-11 rounded-lg border px-3">Tentar processamento novamente</button>}
      {assessment && <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <div><p className="text-xs uppercase tracking-wide text-slate-500">Avaliação da IA</p><h3 className="mt-1 text-lg font-semibold">{verdictLabel[assessment.verdict]}</h3><p className="mt-1 text-slate-500">Critérios atendidos: {assessment.score / 25} de 4</p></div>
        <p className="whitespace-pre-wrap leading-6">{assessment.summary || 'Não houve fala suficiente para gerar um resumo.'}</p>
        <ul className="space-y-2">{assessment.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
        <dl className="space-y-3">{Object.entries(criterionLabel).map(([key, label]) => {
          const fact = assessment.criteria[key as keyof typeof criterionLabel]
          return <div key={key} className="border-l-2 border-slate-200 pl-3"><dt className="font-semibold">{label} • {fact.status === 'met' ? 'Atendido' : fact.status === 'not_met' ? 'Incompatível' : 'A confirmar'}</dt><dd className="mt-1 text-slate-600">{fact.evidence ? <blockquote>“{fact.evidence}”</blockquote> : 'Sem evidência suficiente.'}</dd></div>
        })}</dl>
        {assessment.next_steps.length > 0 && <div><h4 className="font-semibold">Próximos passos</h4><ul className="mt-2 list-disc space-y-1 pl-5">{assessment.next_steps.map((step, i) => <li key={i}>{step}</li>)}</ul></div>}
        <p className="text-xs text-slate-500">Esta avaliação fica no histórico. O estágio comercial continua sob controle da equipe.</p>
      </div>}
      <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold">Transcrição da reunião</summary>
        <div className="mt-4 max-h-96 space-y-4 overflow-y-auto">{!detail.segments.length && <p className="text-slate-500">Nenhum áudio recebido nesta reunião.</p>}{detail.segments.map(segment => <div key={segment.id} id={`segment-${segment.id}`}>
          <p className="text-xs font-semibold text-slate-500">{segment.speaker === 'host' ? 'Atendente' : 'Convidado'} • {Math.floor(segment.start_ms / 60000)}:{String(Math.floor(segment.start_ms / 1000) % 60).padStart(2, '0')}</p>
          <p className="mt-1 whitespace-pre-wrap leading-6">{segment.text || (segment.status === 'failed' ? segment.error : segment.status === 'done' ? 'Sem fala detectada neste trecho.' : 'Transcrevendo…')}</p>
        </div>)}</div>
      </details>
      {detail.reviews.map(review => <div key={review.id} className="rounded-lg bg-blue-50 p-3"><p className="font-semibold">Revisão: {verdictLabel[review.verdict]}</p><p className="mt-1 whitespace-pre-wrap">{review.note}</p><p className="mt-2 text-xs text-slate-500">{review.user_name} • {new Date(review.created_at).toLocaleString('pt-BR')}</p></div>)}
      {assessment && <form className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={e => { e.preventDefault(); void action('review', { verdict, note }) }}>
        <h4 className="font-semibold">Revisar classificação</h4><div><label htmlFor={`${formId}-verdict`} className="block">Resultado</label><select id={`${formId}-verdict`} value={verdict} onChange={e => setVerdict(e.target.value as Verdict)} className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3">{Object.entries(verdictLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor={`${formId}-note`} className="block">Justificativa</label><textarea id={`${formId}-note`} minLength={5} maxLength={2000} required value={note} onChange={e => setNote(e.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></div><button disabled={saving} className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar revisão'}</button>
      </form>}
    </>}
  </section>
}
