# Integração com o ERP (erp.avilaops.com)

> O contrato completo, com o mapa de conciliação e a superfície pública, vive no
> repositório do ERP: `erp.avilaops.com/docs/INTEGRACAO-ERP-CRM.md`. Este
> documento cobre o que é específico deste lado.

---

## O que o CRM ganha

| Evento do ERP | Efeito aqui |
| :--- | :--- |
| `customer.upserted` | contato criado ou enriquecido, com vínculo em `external_references` |
| `order.confirmed` | venda na linha do tempo; opcionalmente fecha o lead |
| `payment.captured` / `payment.refunded` / `payment.failed` | linha do tempo, quem atende precisa saber se o cliente pagou antes de cobrar |

E no sentido inverso: `POST /api/contacts/:id/erp-customer` promove um contato a
cliente do ERP, que é o que permite o pedido apontar para ele.

---

## Colisão de vocabulário que importa

**`Company` no ERP não é `companies` aqui.** Lá é *quem emite a nota* (o CNPJ do
lojista); aqui é *para quem se vende* (a conta B2B do cliente). Nomes iguais,
sentidos opostos, tratá-los como a mesma entidade seria o erro mais caro
possível nesta ponte.

Quem manda em quê:

- **ERP é dono** de pedido, pagamento, estoque, fiscal, CPF/CNPJ, limite de
  crédito e RFM.
- **CRM é dono** de conversa, funil, tarefa, responsável, origem do lead e nome
  de tratamento.

A conciliação em [backend/erp.ts](../backend/erp.ts) respeita isso no SQL: usa
`coalesce(campo_atual, valor_novo)` para o que é nosso, e só sobrescreve o
documento fiscal. Sem dono declarado por campo, os dois sistemas entrariam em
loop revertendo a alteração um do outro.

---

## Como uma pessoa é reconhecida

O CRM usa o vínculo já confirmado com o cliente do ERP. No primeiro evento,
consulta CPF/CNPJ, telefone normalizado e e-mail dentro da empresa. Se essas
chaves apontarem para fichas distintas, o evento fica pendente para revisão.
A opção de criar contatos controla o que acontece quando nenhuma ficha coincide.

O pagamento aparece na ficha por meio do cliente do pedido. Se o pagamento
chegar primeiro, ele passa a aparecer quando o vínculo do pedido estiver
disponível. Pedidos antigos podem recuperar esse vínculo pelo evento de
confirmação já processado.

---

## Configurar

Precisa de dois segredos gerados no ERP (chave de API e segredo da assinatura de
webhook) e do `Tenant.id` de lá:

```bash
curl -X POST /api/integrations/erp/connect \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{
        "baseUrl": "https://erp.avilaops.com",
        "apiKey": "...",
        "webhookSecret": "...",
        "erpTenantId": "...",
        "settings": { "autoWinLeadOnOrder": false, "createMissingContacts": true }
      }'
```

`autoWinLeadOnOrder` vem **desligado**: nem todo pedido nasce de um lead do
funil, e uma recompra no PDV não deveria fechar a negociação aberta de outro
produto.

Os segredos são gravados cifrados (`encryptSecret`, AES-256-GCM), na mesma
tabela `integrations` já usada por Meta e Google.

---

## Operar

- `GET /api/integrations/erp/status` - conectado, eventos pendentes e contagem
  de vínculos por tipo.
- `GET /api/integrations/erp/inbound?onlyErrors=true` - o que chegou e falhou.
- `POST /api/integrations/erp/inbound/:id/retry` • gestor reprocessa um evento da própria empresa.

Um evento que falha numa regra de negócio responde **200** com o erro gravado,
de propósito: reentregar não conserta bug, e faria o ERP repetir até a
dead-letter. Em Configurações › Integrações › ERP Ávila Ops, abra **Eventos do
ERP**. Depois de corrigir a causa, selecione **Reprocessar**. Alterações de um
evento são aplicadas na mesma transação.

Duplicata também responde 200, a entrega do ERP é *at-least-once*, e a segunda
cópia do mesmo evento é comportamento normal, barrada pelo unique
`(tenant_id, source, external_id)` em `inbound_events`.

---

## Segurança da recepção

`POST /api/integrations/erp/webhook` é rota pública: quem chama é o outbox do
ERP, que não tem sessão. A autenticação é a assinatura HMAC-SHA256 do corpo
**cru** (`t=<epoch>,v1=<hex>` sobre `"<t>.<corpo>"`), com janela de 300 s e
comparação `timingSafeEqual`.

O tenant vem do header `x-avila-tenant` e é resolvido contra
`integrations.metadata->>'erp_tenant_id'`. Aceitá-lo do corpo deixaria o
remetente escolher em qual base gravar antes de a assinatura ser conferida.

---

## Pendente

- Cotação de produto dentro da conversa, depende de o CRM conhecer catálogo.
- Reconciliação periódica como fallback do webhook.
