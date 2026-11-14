# Reuniões de vídeo e qualificação de leads

O usuário aprovou videochamadas no CRM, acompanhamento por IA e classificação ao final. LiveKit foi proposto e aprovado como parte desse fluxo. O ambiente de execução solicitado é local, com PostgreSQL e Ollama existentes.

Sinalização e transcrição usam loopback. A mídia WebRTC usa exclusivamente o adaptador virtual privado existente no computador, sem listener na Wi-Fi ou em IPv6 público. UDP somente em loopback falhou no teste real de Chromium; a instalação não cria adaptador, regra de firewall ou exposição externa.

## Experiência e dados

- Criar reunião no painel do lead; atendentes podem criar e conduzir suas reuniões. Equipe da mesma empresa consulta transcrição e avaliação. Só criador ou gestor administra sala e gravação.
- Convidado entra por link de capacidade com segredo aleatório no fragmento, nome e aceite explícito de transcrição. O convite não dá acesso a contatos, lead ou resultados internos. Convite expira após 24 horas ou encerramento.
- Sala de duas pessoas, áudio, vídeo e compartilhamento de tela. Credenciais do LiveKit ficam no backend; JWT de curta duração permite apenas a sala indicada.
- O navegador do atendente captura faixas de áudio separadas, em blocos independentes de até 20 segundos. A tela informa que a transcrição depende do atendente permanecer na sala. Saída normal descarrega blocos pendentes; aviso antes de fechar protege gravação em andamento.
- Áudio temporário vai para fila durável no PostgreSQL, até 2 MB por bloco e 360 blocos por reunião. Um trabalhador serial transcreve por Faster Whisper local; áudio é removido após sucesso. Áudio que falhou permanece por até 24 horas para repetição e depois é removido. Falha fica visível e não é confundida com texto vazio.
- Transcrição, papéis dos falantes, horários, aceite, resumo, critérios e revisão ficam vinculados à reunião, empresa, lead e contato. Reinício retoma fila e avaliações pendentes.
- Ao encerrar, aguardar transcrições pendentes e avaliar toda a transcrição em partes limitadas, sem descartar o início. Critérios iniciais: necessidade, orçamento, poder de decisão e prazo. Só evidências literais atribuídas ao convidado contam; ausência, contradição ou falha de captura impede classificação definitiva.
- Qualificado quando os quatro critérios são atendidos; desqualificado quando existe incompatibilidade explícita sem contradição; demais casos dados insuficientes. Resultado inclui razões e permite revisão humana com motivo. Não muda automaticamente o estágio ou status comercial do lead.
- Nenhuma mensagem ou convite enviado automaticamente. Nenhuma publicação de domínio ou exposição da rede local nesta entrega. Para convidados externos será necessário configurar HTTPS e mídia WebRTC acessível.

## Escolhas

Jitsi atende reuniões prontas, mas LiveKit permite integrar mídia e controles diretamente ao React existente. O primeiro fluxo usa captura no navegador do anfitrião em vez de adicionar um agente RTC Python residente; isso evita dependências nativas de mídia no servidor Windows e mantém explícita a dependência de presença do anfitrião. Whisper e análise rodam no computador; desempenho em tempo real precisa ser medido, e conclusão pode continuar em segundo plano.

## Verificação

Testes de isolamento, convite expirado, aceite, limites, duplicação, fila, evidência e revisão. Testar dois navegadores com áudio/vídeo sintéticos em LiveKit real, transcrição local real de áudio de fixture, inferência real e persistência no PostgreSQL. Estados simulados não comprovam inferência ou mídia real.
