# Experiência de pareamento do WhatsApp

O pedido de melhorar a experiência veio logo após instalar a Evolution local e apresentar um QR em arquivo. O foco desta alteração é tornar o fluxo existente do CRM claro e autossuficiente para usuários com permissão de gestão, mantendo as permissões atuais.

- Diferenciar consulta inicial, desconectado, preparação do código, leitura pendente, conexão confirmada e falha de comunicação.
- Recuperar o QR de um pareamento em andamento e verificar/atualizar o código automaticamente a cada 20 segundos. Enquanto ele ainda não aparece, tentar a cada 5 segundos. Não chamar isso de prazo de validade do QR, pois o provedor não informa esse prazo.
- Consultar status a cada 3 segundos durante pareamento e 10 segundos nos demais estados; pausar requisições quando a página estiver oculta. Uma requisição por vez, cancelamento ao sair e nenhuma resposta antiga aplicada.
- Encerrar requisições sem resposta após 45 segundos e permitir nova tentativa com orientação visível.
- Mostrar instruções de três passos, confirmação com número formatado e acesso à caixa de entrada. Código e erro anterior desaparecem após conexão confirmada.
- Nunca enviar POST de pareamento ou sincronização para um atendente. Mostrar orientação sobre a necessidade de administrador/gerente. Não alterar papéis de usuários.
- Falha de atualização não mantém QR potencialmente desatualizado nem exibe estado verde de conexão sem confirmação recente. Permitir nova tentativa com mensagem simples.
- Não desconectar a instância, enviar mensagens de teste ou mudar os canais existentes.

Verificar apresentação e intervalos com testes, depois o comportamento e o layout no navegador em cenários controlados, além de leitura do estado real. As demais conexões permanecem na seção de opções alternativas existente.

A navegação existente já restringe esta página de Configurações a administradores e gerentes. Nicolas permanece atendente e recebe a orientação de acesso dessa área; o cartão também mantém sua própria proteção de ações para usuários sem gestão. A rota de consulta de status conserva as permissões existentes.
