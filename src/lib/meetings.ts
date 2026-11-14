export type Verdict = 'qualified' | 'disqualified' | 'insufficient_data'
export const verdictLabel: Record<Verdict, string> = { qualified: 'Qualificado', disqualified: 'Desqualificado', insufficient_data: 'Dados insuficientes' }
export const criterionLabel = { need: 'Necessidade', budget: 'Orçamento', authority: 'Poder de decisão', timeline: 'Prazo' }
export type Assessment = {
  verdict: Verdict; score: number; summary: string; reasons: string[]; next_steps: string[]; incomplete: boolean
  criteria: Record<keyof typeof criterionLabel, { status: 'met' | 'not_met' | 'unknown'; evidence: string; segment_id: string | null }>
}
export type Meeting = {
  id: string; lead_id: string; contact_id: string | null; created_by: string; status: 'scheduled' | 'active' | 'ended'
  started_at: string | null; ended_at: string | null; created_at: string; capture_incomplete: boolean
  analysis_status: 'idle' | 'queued' | 'processing' | 'complete' | 'failed'; assessment: Assessment | null; analysis_error: string | null
}
export type MeetingDetail = {
  meeting: Meeting; canHost: boolean
  segments: { id: string; speaker: 'host' | 'guest'; start_ms: number; text: string | null; status: string; error: string | null }[]
  reviews: { id: string; verdict: Verdict; note: string; created_at: string; user_name: string }[]
}
export type RoomEntry = { token: string; url: string; role: 'host' | 'guest'; name: string; startedAt: string }
export async function meetingRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init,
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(init?.signal ? [init.signal] : [])]),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 401 ? 'Entre no CRM para conduzir a reunião.' : data.error ?? 'Não foi possível concluir. Tente novamente.')
  return data as T
}
export function meetingPost<T>(path: string, body: unknown = {}): Promise<T> {
  return meetingRequest<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
export function guestLink(id: string, token: string) { return `${window.location.origin}/meet/${id}/#invite=${encodeURIComponent(token)}` }
