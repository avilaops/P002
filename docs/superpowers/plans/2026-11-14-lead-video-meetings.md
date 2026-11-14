# Reuniões de vídeo • plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chamada dentro do CRM, histórico persistido e qualificação fundamentada após reunião.
**Architecture:** LiveKit para mídia; API autenticada e convite restrito para entrada; captura pelo anfitrião, fila PostgreSQL, Faster Whisper e análise Ollama. Componentes próprios para reunião e histórico no lead.
**Tech Stack:** Next.js/React, Fastify, PostgreSQL, LiveKit, Python/Faster Whisper, Ollama.
**Spec:** `docs/superpowers/specs/2026-11-14-lead-video-meetings.md`.

## Global Constraints

- Duas pessoas, convite de 24 h, JWT de 15 min, consentimento obrigatório.
- Bloco de até 20 s e 2 MB; até 360 blocos; áudio descartado após transcrição.
- Empresa derivada da sessão, convite restrito à sala; nenhum resultado interno para convidado.
- Resultado revisável; não alterar funil automaticamente; informar captura incompleta.
- Trabalho no checkout local já em execução; preservar mudanças anteriores, sem commit/publicação.

## Review Focus

- Reentrada, duplicação de bloco e requisição simultânea com encerramento.
- Convidado tentando consultar resultados ou controlar gravação.
- Dispositivo sem permissão, reconexão, aba fechada, transcrição sem serviço.
- IA inventando citação ou tratando fala do vendedor como resposta do lead.
- Reinício com trabalho em processamento, fim com fila pendente e análise demorada.

## Tarefas

- [x] 1. Testar RED e implementar análise com evidências literais, divisão integral e classificação conservadora (`backend/meeting-analysis.ts`, `backend/test/meeting-analysis.test.mjs`).
- [x] 2. Testar RED e implementar esquema, rotas, convites, fila e processamento (`backend/meetings.ts`, `backend/meeting-worker.ts`, `backend/schema.sql`, `backend/test/meetings.test.mjs`). Registrar em `server.ts`.
- [x] 3. Implementar captura serial, sala pública e histórico do lead (`src/components/meetings/`, `src/lib/meetings.ts`, `src/app/meet/[id]/page.mdx`, `LeadDetailDrawer.tsx`). Testar descarregamento e falhas de captura.
- [x] 4. Instalar LiveKit e Whisper locais; configurar segredos ignorados e iniciar em loopback. Adicionar scripts reproduzíveis e documentação.
- [x] 5. Verificar PostgreSQL real, dois navegadores, transcrição e análise; executar tipos, lint, testes e build. Revisão independente da alteração, corrigir problemas relevantes e registrar evidências.

## Ledger

- Início: aprovação explícita do fluxo anterior pelo usuário. Critérios comerciais padrão anunciados; revisão humana preservada.
- Ruling: usar o checkout local com alterações anteriores • é o ambiente que o usuário está usando, e criar outro checkout excluiria Copiloto e serviços locais ainda não commitados. Preservar todos os arquivos existentes e não criar commits.
- Memória: busca, listagem e captura da iniciativa tentadas; serviço indisponível por timeout.
- Revisão independente: três Important (corrida de onstop no encerramento, substituição de microfone sem mudança de publicação e citação removendo negação) e um Minor (avaliação bloqueada por backlog de outra sala). Todos reproduzidos em testes RED e corrigidos em uma passagem; testes específicos aprovados.
- Verificação adicional: aceite do anfitrião exigido no upload e encerramento idempotente preservando captura/avaliação. Testes RED observados e GREEN após correção.
- Ruling: usar `qwen3:1.7b` exclusivamente para reuniões pelo ambiente `MEETING_AI_MODEL` quando o provedor é Qwen. O modelo de 0.6b não produziu evidências confiáveis; 1.7b passou em avaliação positiva real. Copiloto preserva sua configuração. Custo: modelo maior e análise mais lenta neste computador de 8 GB.
- Serviços: LiveKit 1.13.11 com checksum oficial; Whisper 1.2.1, modelo base/CPU/int8. Sinalização 7880 e Whisper 15435 em loopback; mídia UDP 7882 limitada ao adaptador virtual privado WSL existente. TCP de mídia desabilitado. Migração aplicada após backup do CRM, PostgreSQL mantido. Nenhum domínio publicado.
- E2E real aprovado: sessão de Nicolas atendente, dois navegadores com mídia LiveKit, faixas separadas, transcrição Whisper e avaliação Qwen qualificando com citações, PostgreSQL e funil preservado. Áudio sintético; dados de QA removidos ao final. Artefatos em `output/meetings-smoke-results.json`.
- Avaliação negativa real com Qwen 1.7b identificou falta explícita de orçamento e retornou desqualificado após tornar a instrução de negativas explícita. Falta de informação continua insuficiente.
- Ruling: a sinalização em loopback não restringe os sockets de mídia da distribuição LiveKit. UDP apenas em loopback não estabeleceu PeerConnection no Chromium. Restringir UDP ao adaptador virtual privado já existente funcionou com dois navegadores e evita listeners de mídia na Wi-Fi/IPv6 públicos; sem alteração de firewall ou instalação de adaptador.
- Suíte completa aprovada: 170 testes passam, 15 existentes ignorados; tipos e lint aprovados. Corrigido aviso de lint introduzido no teste de captura, com seus quatro casos reexecutados e aprovados. Build e smoke do servidor em modo produção aprovados, incluindo permissões de mídia só nas salas e cabeçalhos de privacidade.
- Regressão adicional RED/GREEN: encerramento durante a criação de sala remove a sala criada tardiamente e recusa a entrada. A suíte final passou com 171 aprovados e 15 ignorados, sem falhas; tipos/lint aprovados.
- E2E final com mídia exclusivamente no adaptador virtual privado aprovado: dois navegadores, tela e menu de dispositivos em 390 px, classificação real qualificada com Qwen 1.7b, revisão humana pela interface e preservação da avaliação original. Capturas e resultados atualizados em `output/meetings-smoke-results.json`.
- O formulário de revisão passou a usar labels explícitos e IDs únicos para nome acessível estável. Preferência do usuário aplicada aos separadores dos textos novos e ao título global: •.
- Build final e smoke final em modo produção aprovados após as últimas correções. Execução local mantida; sem commit, push ou publicação externa.
