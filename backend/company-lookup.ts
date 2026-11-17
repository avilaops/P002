import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

type User = { tenant_id: string }
type RequireAuth = (request: FastifyRequest, reply: FastifyReply) => Promise<User | null | undefined>

export type CompanyRegistry = {
  cnpj: string
  legalName: string
  tradeName: string | null
  phone: string | null
  email: string | null
  address: string | null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizedCnpj(value: string) {
  const cnpj = value.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) ? cnpj : null
}

export function companyRegistryFromBrasilApi(cnpj: string, input: Record<string, unknown>): CompanyRegistry | null {
  const legalName = text(input.razao_social)
  if (!legalName) return null
  const address = [
    [text(input.descricao_tipo_de_logradouro), text(input.logradouro)].filter(Boolean).join(' '),
    text(input.numero),
    text(input.complemento),
    text(input.bairro),
    [text(input.municipio), text(input.uf)].filter(Boolean).join(' • '),
    text(input.cep),
  ].filter(Boolean).join(', ')

  return {
    cnpj,
    legalName,
    tradeName: text(input.nome_fantasia),
    phone: text(input.ddd_telefone_1) ?? text(input.ddd_telefone_2),
    email: text(input.email)?.toLowerCase() ?? null,
    address: address || null,
  }
}

export async function lookupCompanyRegistry(cnpjInput: string, transport: typeof fetch = fetch) {
  const cnpj = normalizedCnpj(cnpjInput)
  if (!cnpj) throw Object.assign(new Error('Informe um CNPJ válido com 14 caracteres.'), { statusCode: 400 })
  let response: Response
  try {
    response = await transport(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, {
      headers: { accept: 'application/json', 'user-agent': 'AvilaCRM/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
  } catch {
    throw Object.assign(new Error('A consulta de CNPJ está temporariamente indisponível.'), { statusCode: 503 })
  }
  if (response.status === 404) throw Object.assign(new Error('CNPJ não encontrado.'), { statusCode: 404 })
  if (response.status === 400) throw Object.assign(new Error('O serviço recusou este CNPJ como inválido.'), { statusCode: 400 })
  if (!response.ok) throw Object.assign(new Error('A consulta de CNPJ está temporariamente indisponível.'), { statusCode: 503 })
  const payload = await response.json().catch(() => null)
  const company = payload && typeof payload === 'object'
    ? companyRegistryFromBrasilApi(cnpj, payload as Record<string, unknown>)
    : null
  if (!company) throw Object.assign(new Error('O serviço retornou dados incompletos para este CNPJ.'), { statusCode: 502 })
  return company
}

export function registerCompanyLookupRoutes(app: FastifyInstance, deps: { requireAuth: RequireAuth; fetch?: typeof fetch }) {
  app.get('/api/companies/cnpj/:cnpj', async (request, reply) => {
    const user = await deps.requireAuth(request, reply)
    if (!user) return
    const cnpj = (request.params as { cnpj?: string }).cnpj ?? ''
    return { company: await lookupCompanyRegistry(cnpj, deps.fetch) }
  })
}
