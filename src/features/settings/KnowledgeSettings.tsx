import { BookOpen, FileText, HelpCircle, Pencil, Plus, Search, Shield, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import KnowledgeModal from '../../components/modals/KnowledgeModal'
import { Notice } from '../../components/ui/Form'
import { EmptyState } from '../../components/ui/Rows'
import { ToneBadge } from '../../components/ui/StatusBadge'
import { deleteKnowledgeSource, listKnowledgeSources, searchKnowledgeSources, updateKnowledgeSource, type KnowledgeSource } from '../../lib/crm'
import { buttonClass } from '../../lib/ui'
import { SettingsFrame } from './SettingsFrame'

const typeLabels: Record<string, { label: string; icon: typeof FileText }> = {
  faq: { label: 'Perguntas frequentes', icon: HelpCircle },
  document: { label: 'Catálogo e preços', icon: FileText },
  guideline: { label: 'Regras comerciais', icon: Shield },
  url: { label: 'Página', icon: FileText },
}

/** Área de trabalho › Base de conhecimento: o que a IA lê antes de responder. */
export function KnowledgeSettings() {
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<KnowledgeSource | null>(null)
  const [query, setQuery] = useState('')
  const [testResults, setTestResults] = useState<Array<{ id: string; title: string; content: string }>>([])
  const [searching, setSearching] = useState(false)
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((value) => value + 1)

  useEffect(() => {
    let active = true
    listKnowledgeSources()
      .then((result) => active && setSources(result.sources))
      .catch((caught: Error) => active && setError(caught.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [version])

  async function remove(source: KnowledgeSource) {
    if (!window.confirm(`Remover "${source.title}"? A IA deixa de consultar esse conteúdo.`)) return
    try {
      await deleteKnowledgeSource(source.id)
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível remover.')
    }
  }

  async function toggle(source: KnowledgeSource) {
    try {
      await updateKnowledgeSource(source.id, { active: !source.active })
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível alterar.')
    }
  }

  async function testSearch() {
    if (query.trim().length < 2) return
    setSearching(true)
    try {
      const result = await searchKnowledgeSources(query.trim())
      setTestResults(result.sources)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível testar a busca.')
    } finally {
      setSearching(false)
    }
  }

  const visibleSources = query.trim()
    ? sources.filter((source) => `${source.title} ${source.content}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))
    : sources

  return (
    <SettingsFrame
      page="knowledge"
      title="Base de conhecimento"
      description="Perguntas frequentes, catálogo e regras comerciais que a IA consulta antes de responder um cliente."
      actions={
        <button type="button" className={`${buttonClass.primary} shrink-0`} onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" />
          <span className="max-medium:sr-only">Adicionar</span>
        </button>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="text-sm font-medium text-slate-800" htmlFor="knowledge-search">Buscar e testar contexto</label>
          <p className="mt-1 text-xs text-slate-500">A busca de teste usa o mesmo índice lexical e o mesmo isolamento por empresa do agente.</p>
          <div className="mt-3 flex gap-2">
            <input id="knowledge-search" type="search" className="input" value={query} placeholder="Ex.: prazo de implantação" onChange={(event) => { setQuery(event.target.value); setTestResults([]) }} />
            <button type="button" className={buttonClass.secondary} disabled={searching || query.trim().length < 2} onClick={() => void testSearch()}><Search size={16} />{searching ? 'Buscando…' : 'Testar'}</button>
          </div>
          {testResults.length > 0 && <div className="mt-3 space-y-2" role="status">{testResults.map((source) => <article key={source.id} className="rounded-lg bg-slate-50 p-3"><strong className="text-sm text-slate-900">{source.title}</strong><p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">{source.content}</p></article>)}</div>}
          {query.trim().length >= 2 && !searching && testResults.length === 0 && <p className="mt-3 text-xs text-slate-500">Use “Testar” para ver o contexto que seria entregue ao agente.</p>}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white">
          {loading && <p className="px-4 py-6 text-sm text-slate-500">Carregando…</p>}
          {!loading && sources.length === 0 && (
            <EmptyState
              icon={BookOpen}
              title="A IA ainda não tem o que consultar"
              description="Comece pelas perguntas que mais chegam: prazos, formas de pagamento, áreas atendidas."
              action={<button type="button" className={buttonClass.primary} onClick={() => setAdding(true)}>Adicionar conteúdo</button>}
            />
          )}
          <ul className="divide-y divide-slate-100">
            {visibleSources.map((source) => {
              const meta = typeLabels[source.type] ?? typeLabels.faq
              const Icon = meta.icon
              return (
                <li key={source.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{source.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      {meta.label} · consultada {source.times_used} vez(es)
                      {!source.active && <ToneBadge tone="neutral">Pausada</ToneBadge>}
                    </p>
                  </div>
                  <button type="button" className={buttonClass.ghost} onClick={() => toggle(source)}>
                    {source.active ? 'Pausar' : 'Ativar'}
                  </button>
                  <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Editar ${source.title}`} onClick={() => setEditing(source)}><Pencil size={17} aria-hidden="true" /></button>
                  <button
                    type="button"
                    className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remover ${source.title}`}
                    onClick={() => remove(source)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {(adding || editing) && (
        <KnowledgeModal
          source={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null) }}
          onCreated={() => {
            setAdding(false)
            setEditing(null)
            reload()
          }}
        />
      )}
    </SettingsFrame>
  )
}
