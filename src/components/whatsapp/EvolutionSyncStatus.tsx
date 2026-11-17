'use client'

import { useEffect, useState } from 'react'
import { requestEvolution } from '../../lib/evolution'
import type { EvolutionStatus } from '../../lib/evolutionPairing'

export function EvolutionSyncStatus({ enabled = true }: { enabled?: boolean }) {
  const [status, setStatus] = useState<EvolutionStatus | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let pending = false
    const update = async () => {
      if (pending || document.visibilityState !== 'visible') return
      pending = true
      try {
        const next = await requestEvolution<EvolutionStatus>('status', controller.signal)
        if (!controller.signal.aborted) { setStatus(next); setFailed(false) }
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally { pending = false }
    }
    void update()
    const timer = setInterval(() => void update(), 10_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [enabled])

  if (!enabled) return null
  const sync = status?.sync
  const error = failed || sync?.state === 'error'
  const text = failed ? 'Não foi possível verificar a sincronização. Uma nova tentativa será feita automaticamente.'
    : status?.state === 'disconnected' ? 'WhatsApp desconectado • reconecte o aparelho em Configurações.'
      : sync?.error ? sync.error
        : !sync ? 'Aguardando sincronização automática do WhatsApp…'
          : !sync.historyComplete || sync.state === 'syncing'
            ? `Sincronizando histórico • ${sync.imported.toLocaleString('pt-BR')} mensagens importadas`
            : sync.total === 0 ? 'O WhatsApp ainda não disponibilizou histórico. Novas mensagens serão sincronizadas automaticamente.'
              : `Sincronização automática ativa • ${sync.imported.toLocaleString('pt-BR')} mensagens importadas`
  return <details className={`border-b px-4 py-2 text-xs ${error ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
    <summary className="min-h-11 cursor-pointer content-center font-medium" role="status" aria-live="polite">{text}</summary>
    {sync?.lastSuccessAt && <p className="pb-1 pt-2 text-slate-600">Última sincronização • {new Date(sync.lastSuccessAt).toLocaleString('pt-BR')}</p>}
  </details>
}
