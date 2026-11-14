import { api } from './crm'
import type { EvolutionAction } from './evolutionPairing'

export class EvolutionTimeoutError extends Error {
  constructor() {
    super('A verificação demorou mais que o esperado. Tente novamente.')
    this.name = 'EvolutionTimeoutError'
  }
}

export async function requestEvolution<T>(action: EvolutionAction, signal: AbortSignal, timeoutMs = 45000): Promise<T> {
  signal.throwIfAborted()
  const deadline = AbortSignal.timeout(timeoutMs)
  try {
    return await api<T>(`/api/integrations/evolution/${action}`, {
      method: action === 'status' ? 'GET' : 'POST', cache: 'no-store',
      signal: AbortSignal.any([signal, deadline]),
    })
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw new EvolutionTimeoutError()
    throw error
  }
}
