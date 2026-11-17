# Implementação • caixa WhatsApp com mídia

1. Evoluir schema, tipos e armazenamento para avatar, prévia, transcrição e fila durável.
2. Enfileirar mídias e sincronizar avatar pela Evolution sem bloquear o histórico.
3. Implementar worker FFmpeg e cliente Speaches com retries e isolamento por tenant.
4. Expor avatar, prévia, transcrição e estados nos endpoints e eventos em tempo real.
5. Refatorar a caixa de entrada para avatares, bolhas, fundo, previews e transcrição próximos do WhatsApp.
6. Adicionar testes de parser, fila, API e apresentação.
7. Validar tipos, lint, testes, build e navegador em desktop e celular.
8. Publicar aplicação, worker e Speaches; verificar saúde, fila e um canário de mídia.
