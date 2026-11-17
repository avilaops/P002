import assert from 'node:assert/strict'
import test from 'node:test'
import { CONVERSATION_REPLY_SCHEMA, promptConversationReply } from '../../dist-server/ai.js'

test('sugestão de resposta recebe conversa, orientação e conhecimento sem permissão de envio', () => {
  const prompt = promptConversationReply({ tone: 'consultivo', instructions: 'Não ofereça desconto.', history: ['Cliente: Qual o prazo?', 'Atendente: Vou verificar.'], knowledge: '[Prazos]\nImplantação em 5 dias úteis.' })
  assert.equal(CONVERSATION_REPLY_SCHEMA.properties.reply.type, 'string')
  assert.match(prompt[0].content, /rascunho|não envia/i)
  assert.match(prompt[0].content, /Não ofereça desconto/)
  assert.match(prompt[0].content, /5 dias úteis/)
  assert.match(prompt[1].content, /Qual o prazo/)
})
