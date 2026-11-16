# Mídia do WhatsApp no Cloudflare R2 • desenho técnico

## Objetivo

Armazenar novas mídias do WhatsApp em um bucket privado do Cloudflare R2, mantendo no PostgreSQL apenas metadados e preservando a leitura das mídias antigas no volume local durante a migração.

## Arquitetura

- O PostgreSQL continua como fonte de verdade para mensagens, autorização, estado e metadados da mídia.
- O conteúdo binário usa um adaptador com provedores `local` e `r2`.
- Novos objetos no R2 usam a chave `tenants/<tenant_id>/conversations/<conversation_id>/<uuid>.<ext>`.
- O bucket `crm-avilaops-com-media` permanece privado. O navegador acessa somente a rota autenticada existente do CRM.
- Cada linha de `message_media` registra `storage_provider` e `storage_key`. `storage_path` continua durante a transição para compatibilidade com dados antigos.
- `MEDIA_STORAGE_PROVIDER=local` é o padrão. Ao escolher `r2`, todas as credenciais obrigatórias devem existir; configuração incompleta encerra a operação em vez de gravar silenciosamente em outro local.

## Segurança e isolamento

- A consulta de mídia sempre filtra pelo `tenant_id` da sessão.
- A aplicação gera a chave do objeto; nomes enviados pelo usuário não participam do caminho.
- Credenciais R2 ficam somente no backend e devem ser limitadas ao bucket do CRM.
- O bucket não recebe domínio público nem `r2.dev`.
- A rota mantém `Content-Security-Policy`, `Content-Disposition` seguro e autorização atual.

## Migração

- A leitura suporta `local` e `r2` simultaneamente.
- O migrador copia o arquivo, confirma tamanho e SHA-256 e só então atualiza a linha no banco.
- O modo inicial é `dry-run`. A migração não apaga arquivos locais.
- Falhas deixam a linha apontando para a origem anterior e podem ser retomadas.

## Falhas esperadas

- R2 indisponível • a mídia não é marcada como pronta.
- Credencial ausente • a configuração falha de forma explícita.
- Objeto ausente • a rota responde 404 sem tentar outro tenant.
- Checksum divergente • o migrador não altera o banco.

## Fora desta fase

- Upload direto do navegador e URLs pré-assinadas.
- Bucket público ou cache compartilhado.
- Exclusão automática do volume local.
- Fila distribuída para downloads recebidos.

