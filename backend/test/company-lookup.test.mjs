import assert from 'node:assert/strict'
import test from 'node:test'
import Fastify from 'fastify'
import { companyRegistryFromBrasilApi, lookupCompanyRegistry, normalizedCnpj, registerCompanyLookupRoutes } from '../../dist-server/company-lookup.js'

test('normaliza CNPJ formatado e recusa tamanho inválido', () => {
  assert.equal(normalizedCnpj('35.396.075/0001-18'), '35396075000118')
  assert.equal(normalizedCnpj('123'), null)
})

test('mapeia somente os campos empresariais necessários', () => {
  assert.deepEqual(companyRegistryFromBrasilApi('35396075000118', {
    razao_social: 'Silveira Cruz Engenharia Ltda', nome_fantasia: 'Silveira Cruz',
    ddd_telefone_1: '1733334444', email: ' CONTATO@EXAMPLE.COM ',
    descricao_tipo_de_logradouro: 'RUA', logradouro: 'Central', numero: '10',
    bairro: 'Centro', municipio: 'São José do Rio Preto', uf: 'SP', cep: '15000000',
  }), {
    cnpj: '35396075000118', legalName: 'Silveira Cruz Engenharia Ltda', tradeName: 'Silveira Cruz',
    phone: '1733334444', email: 'contato@example.com',
    address: 'RUA Central, 10, Centro, São José do Rio Preto • SP, 15000000',
  })
})

test('consulta usa destino fixo, trata indisponibilidade e exige sessão na rota', async () => {
  const company = await lookupCompanyRegistry('35.396.075/0001-18', async (url) => {
    assert.equal(String(url), 'https://brasilapi.com.br/api/cnpj/v1/35396075000118')
    return Response.json({ razao_social: 'Empresa Teste' })
  })
  assert.equal(company.legalName, 'Empresa Teste')
  await assert.rejects(() => lookupCompanyRegistry('123', fetch), /CNPJ válido/)

  let upstreamCalls = 0
  const app = Fastify()
  registerCompanyLookupRoutes(app, {
    requireAuth: async (_request, reply) => { reply.code(401).send({ error: 'Não autenticado.' }); return null },
    fetch: async () => { upstreamCalls++; return Response.json({ razao_social: 'Nunca' }) },
  })
  const response = await app.inject({ method: 'GET', url: '/api/companies/cnpj/35396075000118' })
  assert.equal(response.statusCode, 401)
  assert.equal(upstreamCalls, 0)
  await app.close()
})
