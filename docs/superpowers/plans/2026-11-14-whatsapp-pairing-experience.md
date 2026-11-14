# WhatsApp — experiência de pareamento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tornar claros o QR, sua atualização automática e a confirmação do WhatsApp no CRM.
**Architecture:** Extrair apresentação e política de atualização para funções testáveis; uma requisição por vez no componente existente, usando as mesmas rotas autenticadas.
**Tech Stack:** React/Next.js, TypeScript e testes Node existentes.
**Spec:** `docs/superpowers/specs/2026-11-14-whatsapp-pairing-experience.md`.

## Global Constraints

- Permissões atuais mantidas; Configurações exige administrador/gerente, e nenhum POST de gestão é permitido para atendente.
- QR: 20 s; preparação sem QR: 5 s; status em pareamento: 3 s; demais estados: 10 s.
- Pausar página oculta, cancelar ao sair, impedir concorrência e respostas antigas.

## Review Focus

- Estado inicial ainda não consultado não pode aparecer como desconectado.
- Resposta conectada remove QR; erro não conserva QR potencialmente antigo.
- Usuário sem gestão nunca dispara POST automático.
- Código ausente continua em preparação e se recupera sem clique.
- Saída da página e mudança de permissão não deixam respostas antigas atualizar a tela.

## Tarefas

- [x] Adicionar testes e observar falha para `evolutionPairingView` e `nextEvolutionAction` em `src/lib/evolutionPairing.ts`, incluindo permissão e intervalos.
- [x] Implementar as funções e a atualização serializada em `src/components/whatsapp/EvolutionCard.tsx`; passar `canManage` de `WhatsAppChannelPage.tsx`.
- [x] Verificar estados, instruções, atualização automática, leitura, erro, usuário atendente e telas estreitas no navegador.
- [x] Executar tipos, lint, testes e build; solicitar revisão independente e corrigir problemas relevantes.

## Evidências

- Dez testes específicos aprovados em `test/web/evolutionPairing.test.ts` e `test/web/evolutionRequest.test.ts`, incluindo falha observada antes das implementações.
- Revisão independente encontrou ausência de limite de espera e consulta inicial com página oculta. Ambos corrigidos: prazo de 45 s com erro recuperável e política de visibilidade aplicada desde a montagem.
- `output/whatsapp-ux-regressions.cjs`: cenários de página inicialmente oculta e requisição sem resposta aprovados no Chromium.
- `output/whatsapp-ux-results.json`: QR inicial e atualização após 20 s, recuperação de falha, confirmação conectada, sincronização, requisições serializadas, saída da página, bloqueio existente para Nicolas atendente e largura de 390 px verificados no navegador. Respostas Evolution desses cenários foram controladas; não comprovam pareamento real.
- Capturas em `output/whatsapp-ux-qr-desktop.png`, `output/whatsapp-ux-qr-mobile.png`, `output/whatsapp-ux-connected.png` e `output/whatsapp-ux-attendant.png`.
- Tipos, lint e build aprovados; lint mantém avisos existentes. Suíte completa: 153 testes aprovados e 15 ignorados, sem falhas.
- Leitura real ao final: WhatsApp `disconnected`; pareamento no celular ainda pendente. Saúde do CRM confirma PostgreSQL conectado. Nenhum envio de mensagem, desconexão ou alteração de papel de usuário foi realizado.
