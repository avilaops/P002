# CRM • histórico automático e respostas de e-mail

## Diagnóstico verificado

Produção em `128ca89`: Evolution conectada com zero mensagens persistidas. O serviço tinha `DATABASE_SAVE_DATA_NEW_MESSAGE=false`, `DATABASE_SAVE_DATA_HISTORIC=false`, `DATABASE_SAVE_DATA_CHATS=false` e `DATABASE_SAVE_MESSAGE_UPDATE=false`; a instância do CRM também tinha `syncFullHistory=false`. O conector só consulta a primeira página de 100 registros e ignora mensagens sem texto e identificadores alternativos. O leitor de e-mail não tem formulário nem rota de resposta.

## Entrega autorizada

- [x] Habilitar persistência e histórico no serviço e na criação de novas instâncias, preservando sessão e volumes.
- [x] Importar automaticamente todas as páginas disponíveis, com progresso persistente, retomada e deduplicação.
- [x] Exibir conversas individuais, grupos e mensagens de mídia disponíveis sem fabricar números de telefone ou conteúdo ausente.
- [x] Manter atualização do inbox e tornar erros/progresso da sincronização visíveis.
- [x] Adicionar resposta individual de e-mail com destinatário obtido da mensagem original, conta do tenant, cabeçalhos de encadeamento e confirmação por clique.
- [ ] Cobrir paginação, isolamento, reconexão, respostas e falhas com testes; validar no navegador e publicar.

Não enviar mensagens reais como teste. A extensão do histórico antigo depende do que o WhatsApp voltar a fornecer: mensagens nunca persistidas não podem ser declaradas recuperadas. Não excluir a sessão nem exigir novo pareamento sem antes verificar o que a reconexão disponibiliza.

## Verificação

- Evolution permaneceu conectada após habilitar persistência e histórico; a API passou de zero a 24 mensagens armazenadas durante a verificação.
- Testes direcionados: 12 Evolution e 7 respostas de e-mail. Incluem 601 mensagens, retomada, deduplicação, download temporariamente indisponível e envio concorrente.
- Revisão independente corrigida: ordenação do histórico no SSE, repetição de downloads, confirmação idempotente antes do IMAP e orientação de envio incerto.
- Navegador com respostas controladas: formulário de resposta, confirmação, bloqueio duplicado, progresso da sincronização e limpeza dos filtros. Desktop e celular de 390 px sem transbordamento horizontal. Nenhum envio real.
- Backend completo: 103 testes aprovados e 22 integrações opcionais ignoradas localmente. O teste de telemetria exige OpenSSL disponível no PATH; no Windows foi usado o executável incluído no Git.
- Web: 69 testes aprovados. Lint sem erros, com avisos preexistentes.
