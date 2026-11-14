# Copiloto local — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir conversar com Qwen local pelo painel do CRM.
**Architecture:** Uma rota autenticada usa a configuração e as fontes da empresa; o painel cliente mantém histórico e apresenta resposta, andamento e erros. Ollama standalone no Windows fornece o modelo local.
**Tech Stack:** Fastify, PostgreSQL, React/Next.js, Ollama.
**Spec:** `docs/superpowers/specs/2026-11-13-copilot-local-design.md`.

## Global Constraints

- Sessão determina tenant/usuário; nenhuma alteração de registros pelo modelo.
- 12 mensagens, 2.000 caracteres individuais e 6.000 no total; deadline de 90 segundos.
- Não persistir conteúdo de conversa nem credenciais em `ai_runs`.
- Reutilizar dependências existentes e configurar somente o ambiente local.

## Review Focus

- Sessão ausente, tentativa de informar outro tenant e papel `system`: rejeitar antes da inferência.
- Fontes inativas ou de outra empresa: não consultar nem enviar ao provedor.
- Falha, timeout ou resposta vazia: erro público seguro e registro de uso com falha.
- Mensagens longas e histórico extenso: preservar a pergunta recente dentro do limite.
- Cancelamento e novo chat durante envio: ignorar resposta tardia e liberar o formulário.

## Tarefas

### 1. Contrato de conversa e backend

**Files:** criar `backend/copilot.ts`, `backend/test/copilot.test.mjs`; registrar em `backend/server.ts`.
**Interface:** `registerCopilotRoutes(app, { requireAuth, decryptSecret, query?, loadConfig?, fetch?, timeoutMs? })`; HTTP recebe `{ messages: { role: 'user' | 'assistant', content: string }[] }` e responde `{ message: { role: 'assistant', content: string }, sources: { id: string, title: string }[] }`.

- [x] Escrever e observar falhar o contrato de autenticação na rota ainda inexistente.
- [x] Adicionar testes de validação, tenant, conhecimento, provedor, cancelamento por deadline e contabilização.
- [x] Implementar rota e registro; usar `loadAiConfig`, requisição compatível OpenAI/Anthropic e `rastrearIa`.
- [x] Rodar testes de backend; conferir que a consulta de conhecimento é somente leitura e limitada ao tenant.

### 2. Interface de conversa

**Files:** modificar `src/components/layout/Copilot.tsx`, `src/lib/ai.ts`; criar `src/lib/copilot.ts` e `test/web/copilot.test.ts`.
**Interface:** `sendCopilotMessage(messages, signal?)`; `recentCopilotMessages(messages)` limita o histórico.

- [x] Testar histórico recente e limites, observar falhar e implementar.
- [x] Implementar formulário acessível, histórico, fontes, envio único, andamento, cancelamento e novo chat.
- [x] Validar tipos, lint e testes do projeto.

### 3. Modelo local e validação final

**Files:** instalação fora do repositório; configuração ignorada no banco local; documentação no README.

- [x] Baixar/verificar Ollama oficial, extrair no diretório local do usuário e iniciar em loopback com limites de memória/contexto.
- [x] Baixar `qwen3:0.6b`, testar uma inferência e configurar a empresa local via API autenticada.
- [x] Exercitar conversa real e falhas no navegador com a conta local de Nicolas; solicitar revisão independente e resolver problemas relevantes.
- [x] Registrar evidências e deixar CRM, Auth, PostgreSQL e Ollama rodando localmente.

## Evidências de 14/11/2026

- Ollama 0.40.16 verificado pelo SHA-256 publicado no release oficial, instalado fora do repositório; serviço em `127.0.0.1:11434`, nuvem desativada, CPU, um modelo e uma geração simultânea.
- `qwen3:0.6b` baixado e configurado na empresa local. A primeira inferência direta respondeu em 4,07 segundos; no navegador, a pergunta com fonte levou 1,38 s e sua continuação 1,27 s.
- Revisão independente encontrou três problemas relevantes: cancelamento durante configuração, deadline que não abrangia leituras/contabilização e proxy de desenvolvimento de 30 s. As regressões falharam antes das correções e passaram depois; nenhum problema menor foi adiado.
- Testes focados: 13 de backend e 4 de frontend. Suíte completa: 143 aprovados, 15 testes de integração de banco não habilitados nesta execução. O OpenSSL instalado com Git foi incluído apenas no PATH do comando de testes.
- `npm run typecheck`, `npm run lint` e `npm run build` concluídos. O lint mantém avisos preexistentes em outros arquivos.
- Navegador com login real de Nicolas: Qwen e fonte da empresa, continuação, cancelar, novo chat, erro, recolher/reabrir, geração simulada de 31,16 s atravessando o proxy e retorno ao modelo local real. Resultado em `output/copilot-local-results.json`; captura em `output/copilot-local-conversation.png`. A fonte temporária de teste foi removida.
