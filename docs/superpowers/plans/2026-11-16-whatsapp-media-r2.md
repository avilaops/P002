# Mídia do WhatsApp no Cloudflare R2 • plano de implementação

**Objetivo:** mover novas mídias para armazenamento de objetos privado e preparar uma migração segura das mídias existentes.

**Arquitetura:** adaptadores `local` e `r2` atrás de um contrato único. O banco registra provedor e chave; a rota autenticada transmite o objeto sem expor credenciais. Leituras antigas continuam no volume durante a migração.

**Tecnologia:** Node.js 20+, TypeScript, PostgreSQL, Cloudflare R2 pela API compatível com S3 e `@aws-sdk/client-s3`.

## Tarefas

- [x] Provisionar o bucket privado `crm-avilaops-com-media` na conta Avila Ops.
- [x] Criar testes de contrato para configuração, chave isolada por empresa e adaptadores local/R2.
- [x] Implementar o contrato de armazenamento e o cliente R2 com configuração estrita.
- [x] Adicionar `storage_provider` e `storage_key` ao schema sem quebrar linhas existentes.
- [x] Atualizar entrada, histórico, repetição, saída e download para usar o contrato.
- [x] Criar migrador com `dry-run`, verificação SHA-256 e retomada sem exclusão.
- [x] Documentar variáveis, operação, reversão e credenciais mínimas.
- [x] Rodar testes direcionados, tipos, lint, suíte completa e build.
- [x] Configurar credenciais no servidor, validar um objeto canário e publicar sem migrar dados automaticamente.

## Estado em produção

O commit `98528e2` foi publicado pela pipeline `43955266478`. O serviço está saudável e o schema contém `storage_provider` e `storage_key`. Em 17/11/2026, a credencial R2 existente passou em PUT, GET, SHA-256 e DELETE contra o bucket; o adaptador publicado repetiu o mesmo canário com chave isolada por tenant e conversa. `MEDIA_STORAGE_PROVIDER=r2` foi ativado com backup do ambiente e rollback automático. O lote inicial migrou 49 objetos e 9.719.009 bytes, com zero falhas; o banco e o bucket conferiram 49 itens. As cópias locais não foram apagadas.

## Regras de implantação

- Não criar acesso público ao bucket.
- Não registrar ou imprimir segredos.
- Não excluir a cópia local nesta fase.
- Não mudar `MEDIA_STORAGE_PROVIDER` em produção antes de o canário de gravação e leitura passar.
- Em reversão, voltar novas gravações para `local`; objetos já gravados no R2 continuam legíveis pelo provedor registrado na linha.

