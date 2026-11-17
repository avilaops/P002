# CRM omnichannel e inteligência operacional

## Objetivo

Completar Instagram, Messenger, e-mail, chat do site, integrações, agente de IA e base de conhecimento sem criar silos paralelos. Conversas sociais e do site usam o mesmo núcleo `channels` • `conversations` • `messages`, sempre limitado por `tenant_id`.

## Arquitetura

### Instagram e Messenger

Uma integração Meta Messaging guarda credenciais cifradas no servidor. Cada página ou conta conectada vira um canal com `provider` igual a `instagram` ou `messenger`. O webhook valida assinatura, localiza o canal pelo identificador externo, resolve a identidade do contato por uma tabela de vínculo e grava a mensagem no inbox. A resposta usa o endpoint Send API adequado ao provedor.

### Chat do site

Cada empresa cria um canal `webchat` com chave pública revogável, origens permitidas e aparência. A sessão do visitante usa token aleatório armazenado apenas como hash. Mensagens públicas entram no mesmo inbox; respostas dos atendentes são lidas pelo widget por consulta incremental. Nenhum endpoint público aceita `tenant_id` informado pelo navegador.

### E-mail

O IMAP e SMTP existentes continuam como transporte. O CRM passa a agrupar mensagens por conversa, relacionar remetentes a contatos e registrar respostas com encadeamento. O inbox mantém paginação e respostas idempotentes.

### Integrações

O catálogo expõe estado real, erro e ação de Threads, Meta Messaging, Messageria, ERP, Google Agenda e n8n. Pagamentos permanece indisponível enquanto não existir contrato de servidor, sem selo falso de conexão.

### Agente de IA e base de conhecimento

As fontes passam por busca lexical limitada ao tenant, com contagem de uso e referências explícitas. O agente usa somente as fontes selecionadas, registra execução e mantém resposta autônoma desativada por padrão. Fontes por URL exigem conteúdo fornecido ou importação controlada pelo servidor.

## Segurança e limites

• Credenciais nunca retornam ao cliente.

• Webhooks Meta exigem assinatura HMAC e são idempotentes.

• Tokens do chat são armazenados como SHA-256 e podem ser revogados.

• Toda consulta autenticada inclui `tenant_id`; toda consulta pública resolve o tenant por uma chave opaca.

• HTML de e-mail permanece em `iframe` sem permissões.

• Envio autônomo de IA continua opt-in e auditável.

## Aceite

• Instagram, Messenger e chat do site recebem e respondem no inbox.

• E-mail apresenta conversas encadeadas e resposta vinculada.

• Integrações mostram estados reais, sem carregamento permanente ou conexões fictícias.

• Agente cita fontes pertinentes e isoladas por empresa.

• Base de conhecimento permite criar, editar, ativar, buscar e testar fontes.

• Tipos, lint, testes, build e fluxos de navegador aprovados.
