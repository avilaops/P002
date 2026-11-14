import assert from 'node:assert/strict'
import test from 'node:test'
const { splitTranscript, assessMeeting, analyzeMeeting } = await import('../../dist-server/meeting-analysis.js')
const transcript = [{ id: 's1', speaker: 'guest', text: 'Preciso automatizar vendas. Tenho cinco mil reais. Sou o responsável pela decisão. Quero começar em trinta dias.', start_ms: 0 }]
const facts = {
  need: { status: 'met', evidence: 'Preciso automatizar vendas.' },
  budget: { status: 'met', evidence: 'Tenho cinco mil reais.' },
  authority: { status: 'met', evidence: 'Sou o responsável pela decisão.' },
  timeline: { status: 'met', evidence: 'Quero começar em trinta dias.' },
}
const part = criteria => ({ summary: 'Lead apresentou demanda e prazo.', next_steps: ['Preparar proposta.'], criteria })
test('qualificação exige quatro evidências reais do convidado', () => {
  const result = assessMeeting([part(facts)], transcript, false)
  assert.equal(result.verdict, 'qualified')
  assert.equal(result.score, 100)
  assert.equal(result.criteria.need.segment_id, 's1')
})
test('citação inventada e fala do vendedor não contam como critério', () => {
  const result = assessMeeting([part({ ...facts, budget: { status: 'met', evidence: 'Tenho dez mil reais disponíveis.' } })], [...transcript, { id: 's2', speaker: 'host', text: 'Tenho dez mil reais disponíveis.', start_ms: 100 }], false)
  assert.equal(result.verdict, 'insufficient_data')
  assert.equal(result.criteria.budget.status, 'unknown')
})
test('contradição vira dado insuficiente e captura incompleta impede resultado definitivo', () => {
  const extra = { id: 's2', speaker: 'guest', text: 'Não tenho orçamento para contratar.', start_ms: 200 }
  const result = assessMeeting([part(facts), part({ budget: { status: 'not_met', evidence: extra.text } })], [...transcript, extra], false)
  assert.equal(result.verdict, 'insufficient_data')
  assert.equal(result.criteria.budget.status, 'unknown')
  assert.equal(assessMeeting([part(facts)], transcript, true).verdict, 'insufficient_data')
})
test('incompatibilidade explícita fundamenta desqualificação e ausência não', () => {
  const rows = [{ id: 's3', speaker: 'guest', text: 'Não precisamos desse serviço.', start_ms: 0 }]
  assert.equal(assessMeeting([part({ need: { status: 'not_met', evidence: rows[0].text } })], rows, false).verdict, 'disqualified')
  assert.equal(assessMeeting([], [], false).verdict, 'insufficient_data')
})
test('citação não pode remover a negação de uma frase do convidado', () => {
  const rows = [{ id: 'negative', speaker: 'guest', start_ms: 0, text: 'Não preciso automatizar vendas. Não tenho orçamento disponível. Não sou responsável pela decisão. Não quero começar este mês.' }]
  const forged = Object.fromEntries(['need','budget','authority','timeline'].map((key, i) => [key, { status: 'met', evidence: ['preciso automatizar vendas.', 'tenho orçamento disponível.', 'sou responsável pela decisão.', 'quero começar este mês.'][i] }]))
  assert.equal(assessMeeting([part(forged)], rows, false).verdict, 'insufficient_data')
  assert.equal(assessMeeting([part(forged)], rows, false).score, 0)
})
test('divisão cobre toda a transcrição sem perder início nem fim', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), speaker: 'guest', text: `trecho-${i} ${'palavra '.repeat(35)}`, start_ms: i * 1000 }))
  const parts = splitTranscript(rows, 450)
  assert.ok(parts.length > 1)
  assert.deepEqual(parts.flat().map(s => s.text), rows.map(s => s.text))
  assert.ok(parts.every(chunk => chunk.reduce((n, s) => n + s.text.length, 0) <= 450))
})
test('análise usa provedor configurado, JSON, deadline e todas as partes', async () => {
  const calls = []
  const config = { provider: 'qwen', model: 'qwen3:0.6b', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }
  const result = await analyzeMeeting(transcript, config, false, { fetch: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return Response.json({ choices: [{ message: { content: JSON.stringify(part(facts)) } }] })
  } })
  assert.equal(result.verdict, 'qualified')
  assert.equal(calls[0].url, `${config.baseUrl}/chat/completions`)
  assert.equal(calls[0].body.response_format.type, 'json_schema')
  assert.equal(calls[0].body.reasoning_effort, 'none')
  assert.ok(calls[0].init.signal)
  assert.equal(calls[0].body.tools, undefined)
  await assert.rejects(analyzeMeeting(transcript, config, false, { fetch: async () => Response.json({ error: 'private-key' }, { status: 500 }) }), /análise/i)
})
