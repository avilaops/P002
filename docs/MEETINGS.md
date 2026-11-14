# Videochamadas e avaliação comercial

Abra **Vendas → Oportunidades**, selecione o lead e use **Nova videochamada**. O cartão mostra o link do convidado e o acesso do atendente à sala. Gerar um novo convite invalida o anterior. O convite vale por 24 horas ou até o encerramento.

Ambos os participantes precisam aceitar a transcrição antes de entrar. A sala comporta duas pessoas, com microfone, câmera e compartilhamento de tela. O convidado recebe apenas acesso à chamada; transcrição, cadastro e avaliação são internos à equipe. Criador da reunião ou gestor pode conduzir, encerrar e repetir processamento. Outros membros autenticados da mesma empresa podem consultar o histórico e registrar uma revisão fundamentada.

O navegador do atendente captura áudio separado por participante em blocos independentes de até 20 segundos. A transcrição depende de o atendente permanecer na sala. O texto aparece no histórico conforme o processamento local termina. **Encerrar e avaliar reunião** aguarda o último áudio e os envios pendentes; a análise começa depois das transcrições. Fechar a aba ou trocar de dispositivo pode interromper a captura, e isso é indicado para revisão. Uma reunião interrompida pode ser encerrada pelo histórico no painel do lead.

## Avaliação e revisão

Os critérios iniciais são necessidade, orçamento, poder de decisão e prazo. A IA propõe fatos com citações completas da fala do convidado. O servidor verifica a citação contra a transcrição e rejeita trechos que removem o início de uma frase, inclusive negações. Fala do atendente não atende critérios do cliente.

- **Qualificado:** os quatro critérios possuem evidências positivas.
- **Desqualificado:** existe incompatibilidade explícita, sem contradições detectadas entre as partes analisadas.
- **Dados insuficientes:** faltam informações, há contradição ou a captura/transcrição ficou incompleta.

O resumo e os próximos passos são sugestões da IA; a revisão humana fica registrada com usuário, data e motivo, sem apagar a avaliação original. O resultado não altera automaticamente etapa, ganho ou perda da oportunidade. Toda a transcrição é dividida em partes limitadas para análise; o início não é descartado para caber no contexto. Falha ou prazo excedido deixa a análise como falha recuperável, em vez de publicar uma avaliação parcial como definitiva.

O modelo `qwen3:0.6b` não forneceu evidências confiáveis no teste inicial. As reuniões locais usam `qwen3:1.7b`; o Copiloto mantém sua configuração anterior. Mesmo com o modelo maior, o desempenho e a qualidade dependem do áudio, das respostas do cliente e do hardware. As avaliações podem levar alguns minutos e continuam em segundo plano.

## Onde fica o histórico

Tudo fica no banco PostgreSQL do CRM (`agenda_crm` nesta instalação), separado por `tenant_id`:

- `lead_meetings`: vínculo com lead/contato, responsável, aceite, datas, resultado e estado do processamento.
- `meeting_audio_chunks`: fila durável, papel do falante, horário, transcrição e estado de cada bloco.
- `meeting_reviews`: revisões com justificativa e autoria.
- `events` e `ai_runs`: evento no lead e metadados de execução, sem copiar áudio ou transcrição para logs de observabilidade.

Não é armazenado vídeo. O áudio temporário é removido após transcrição bem-sucedida. Áudio que falhou é mantido por até 24 horas para repetir o processamento; depois é removido e o trecho continua identificado como incompleto. São permitidos até 2 MB por bloco e 360 blocos por reunião. Transcrição e avaliação permanecem enquanto a reunião existir; excluir a oportunidade exclui suas reuniões por vínculo de banco.

Filas são retomadas pelo backend. Trabalho interrompido sem encerramento gracioso volta após a expiração da reserva: 5 minutos para áudio e 15 minutos para avaliação. O processamento alterna áudio e avaliações prontas para evitar que outras chamadas bloqueiem indefinidamente uma reunião encerrada. Reiniciar normalmente o backend devolve seu trabalho pendente à fila.

## Instalação local no Windows

LiveKit Server 1.13.11 e Faster Whisper 1.2.1 foram instalados em `%LOCALAPPDATA%/avilaops/crm-meetings`. A distribuição oficial do LiveKit foi verificada com o SHA-256 publicado: `5d071ea43339f0140d24a66f0b2ff8a7bf6c4d0dceb19b30abca835670213667`.

Com PostgreSQL e Ollama já executando, no PowerShell 7:

```powershell
./scripts/meetings/setup-local.ps1
npm run db:migrate
./scripts/meetings/start-local.ps1
```

O setup usa o Python 3.10 instalado pelo uv neste computador. Em outro ambiente, passe `-Python 'C:/caminho/python.exe'`. Ele cria ambiente Python próprio, instala Whisper, baixa o modelo Qwen de reuniões quando encontra o Ollama local e gera credenciais aleatórias. A primeira inicialização do Whisper baixa o modelo multilíngue `base`; CPU, quantização int8 e duas threads. Em seguida, reinicie o backend do CRM para ler o ambiente.

Variáveis: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MEETING_STT_URL`, `MEETING_STT_KEY` e `MEETING_AI_MODEL`. Segredos ficam no `.env.local` ignorado do CRM e em `local-config.json` fora do repositório. O setup preserva uma cópia anterior do ambiente na pasta do serviço. O backup do banco anterior à migração está em `%LOCALAPPDATA%/avilaops/crm-local/backups/pre-meetings-20261114.dump`.

LiveKit mantém a sinalização em loopback na porta 7880. A mídia UDP 7882 fica restrita, por `rtc.ips.includes`, ao IPv4 do adaptador virtual WSL que já existe na máquina; Wi‑Fi e IPv6 públicos não são usados. A tentativa com UDP somente em `127.0.0.1` não estabeleceu a mídia no teste com Chromium. Mídia TCP fica desabilitada porque o listener dessa versão usa endereço coringa. O setup detecta o adaptador virtual e aceita `-MediaIp` para um endereço privado local explícito; não cria adaptador nem altera firewall.

A criação automática de salas está desabilitada: somente o backend cria a sala antes de emitir JWT restrito de 15 minutos. Whisper escuta em `127.0.0.1:15435`, com chave própria, sem CORS. Os logs ficam em `livekit.out.log`, `livekit.err.log`, `whisper.out.log` e `whisper.err.log` na pasta local do serviço.

Se o IPv4 do adaptador virtual mudar após reiniciar o Windows/WSL, execute o setup novamente para atualizar o filtro de mídia e reinicie o LiveKit.

Esta entrega funciona em `http://localhost:5173`. Para clientes fora do computador, é necessário publicar o frontend com HTTPS, configurar LiveKit com WSS e rotas de mídia WebRTC/TURN acessíveis. Nenhum domínio, redirecionamento de porta ou publicação externa foi criado. O serviço Windows registra que não oferece monitoramento automático de capacidade de CPU; esta instalação é destinada à validação local de salas de duas pessoas.

## Verificação

Testes de análise: `backend/test/meeting-analysis.test.mjs`. Captura e envio: `test/web/meetingCapture.test.ts`. Rotas, isolamento e fila: `backend/test/meetings.test.mjs`, que só usa banco quando `CRM_MEETINGS_TEST_DATABASE_URL` é informado; nesta sessão foi criado o banco separado `crm_meeting_qa_20261114`.

`output/meetings-smoke.cjs` valida a sessão real de Nicolas como atendente, dois navegadores em LiveKit real, áudio sintético em português, Whisper real, Ollama real, persistência e ausência de alteração do funil. Os dados de teste criados no CRM são removidos ao final. Evidências locais: `output/meetings-smoke-results.json`, `output/meetings-live-call.png` e `output/meetings-real-assessment.png`.

Referências oficiais: [LiveKit local](https://docs.livekit.io/transport/self-hosting/local/), [servidor LiveKit](https://github.com/livekit/livekit), [componentes React](https://docs.livekit.io/reference/components/react/), [Faster Whisper](https://github.com/SYSTRAN/faster-whisper) e [Ollama com LiveKit](https://docs.livekit.io/agents/models/llm/ollama/).
