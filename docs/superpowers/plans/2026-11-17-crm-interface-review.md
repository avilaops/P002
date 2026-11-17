# CRM Interface Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a revisão aprovada de Canais, Integrações e Caixa de entrada com clareza, responsividade e acessibilidade.

**Architecture:** Preservar componentes e contratos existentes, extrair regras puras de apresentação para `inboxPresentation.ts` e evoluir a composição Tailwind dos três fluxos. Nenhuma API ou persistência será alterada.

**Tech Stack:** Next.js 16.4.5 • React 19.2.7 • TypeScript 6 • Tailwind CSS 4.3.3 • Lucide React

**Spec:** `docs/superpowers/specs/2026-11-17-crm-interface-review-design.md`

## Global Constraints

• Preservar APIs, isolamento por empresa e regras da janela de 24 horas.

• Usar `•` como separador em textos do produto.

• Não mostrar identificadores `@lid` como identidade do contato.

• Manter alvos interativos com pelo menos 44 px e foco visível.

## Review Focus

• Contato sem nome e com telefone `@lid` deve aparecer como `Contato sem nome`.

• Estado ainda carregando deve ser anunciado sem reticências ambíguas.

• Conversa sem mensagens não pode quebrar agrupamento por data.

• Ações existentes devem continuar acessíveis no celular.

• Textos e controles precisam permanecer legíveis em 200% de zoom.

---

### Task 1: Modelos de apresentação testáveis

**Files:**
- Create: `src/features/workspace/inboxPresentation.ts`
- Create: `test/web/inbox-presentation.test.ts`

**Interfaces:**
- Produces: `contactLabel`, `contactSecondaryLabel`, `groupMessagesByDay` e `messageStatusMeta`.

- [ ] Escrever testes para LID, telefone, fallback, agrupamento vazio e status desconhecido.
- [ ] Executar o teste e confirmar falha inicial.
- [ ] Implementar as funções puras.
- [ ] Executar o teste e confirmar aprovação.

### Task 2: Canais e Integrações canônicos

**Files:**
- Modify: `src/features/settings/ChannelsSettings.tsx`
- Modify: `src/features/settings/IntegrationCenterPage.tsx`
- Modify: `src/components/ui/Rows.tsx`
- Modify: `src/components/ui/StatusBadge.tsx`

**Interfaces:**
- Consumes: estados `ConnectionState` existentes.
- Produces: resumo de saúde, ações explícitas e catálogo sem duplicação.

- [ ] Criar teste estático para itens canônicos, estados textuais e ausência de duplicações.
- [ ] Executar o teste e confirmar falha inicial.
- [ ] Implementar resumos, ações e catálogo exclusivo de integrações.
- [ ] Executar testes web e confirmar aprovação.

### Task 3: Caixa de entrada operacional

**Files:**
- Modify: `src/features/workspace/WorkspacePages.tsx`
- Modify: `src/components/whatsapp/EvolutionSyncStatus.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: funções de `inboxPresentation.ts`.
- Produces: lista legível, conversa centralizada, divisores de data, status acessível e compositor fixo.

- [ ] Criar teste estático dos invariantes de layout e acessibilidade.
- [ ] Executar o teste e confirmar falha inicial.
- [ ] Implementar lista, cabeçalho, mensagens e compositor.
- [ ] Executar testes web e confirmar aprovação.

### Task 4: Responsividade e validação final

**Files:**
- Modify: `src/features/settings/SettingsPages.tsx`
- Modify: `.agents/equipe/controle.json`
- Create: `output/interface-review-2026-11-17/results.json`

**Interfaces:**
- Produces: evidências de desktop, tablet e celular.

- [ ] Ajustar largura responsiva da navegação de configurações.
- [ ] Executar typecheck, lint, testes web e build.
- [ ] Validar as três telas em 390×844, 960×900 e 1440×900.
- [ ] Corrigir regressões encontradas e repetir verificações.
- [ ] Registrar evidências e concluir a demanda no controle da equipe.

