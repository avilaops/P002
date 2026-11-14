# Copiloto local do CRM

O usuário aprovou instalar Qwen3 0.6B via Ollama e conectar o painel existente a uma conversa real. O computador tem 8 GB de RAM; a instalação será local ao usuário, com um modelo carregado e uma geração por vez no Ollama.

## Abordagem

Usar o suporte Qwen/Ollama já existente, sem chave externa. Groq exigiria internet e uma API externa; modelos maiores consumiriam mais memória. A implementação continua usando o provedor configurado por empresa, sem trocar a configuração de produção.

## Comportamento

- `POST /api/ai/chat` exige sessão e recebe somente mensagens de usuário/assistente; o tenant e o usuário vêm da sessão.
- Até 12 mensagens, 2.000 caracteres por mensagem e 6.000 por requisição. A interface mantém a conversa em memória e envia o histórico recente dentro desses limites.
- O contexto inclui fontes de conhecimento ativas e pertinentes da própria empresa, com conteúdo limitado. O modelo responde em português e não executa alterações no CRM.
- Resposta em texto, sem renderização de HTML do modelo; fontes consultadas aparecem junto da resposta.
- Uso registrado em `ai_runs`, sem gravar o conteúdo da conversa ou credenciais no registro.
- Configuração ausente, IA desativada, provedor indisponível, resposta vazia e timeout geram mensagens reais. O prazo máximo da chamada é 90 segundos.
- O painel permite enviar, continuar e iniciar novo chat; impede envio duplicado, mostra andamento e permite cancelar. Cancelar/novo chat impede que uma resposta antiga entre na conversa nova.
- O ambiente local usa `qwen3:0.6b` e `http://127.0.0.1:11434/v1`, sem raciocínio estendido. O Ollama escuta somente em loopback.

## Verificação

Testes de contrato HTTP e isolamento por empresa, falhas do provedor e montagem de histórico; testes existentes, tipos e lint. Teste de navegador com login real de Nicolas, inferência real do Ollama, continuação, novo chat e erro de conexão. Não publicar nem enviar mensagens externas.
