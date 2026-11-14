# Descoberta pública do CRM • plano de implementação

> Execução: fluxo Main no checkout atual, preservando o trabalho existente. Verificar cada contrato antes e depois da alteração.

**Objetivo:** permitir que buscadores descubram e indexem o produto em `https://crm.avilaops.com/`.

**Arquitetura:** metadados públicos no layout raiz e metadados próprios nas quatro páginas públicas existentes. Layouts dos dez grupos internos preservam `noindex,nofollow`. Um catálogo público compartilhado alimenta os metadados, os dados estruturados, o sitemap e o índice textual para agentes.

**Tecnologias:** Next.js 16.4.5, React, MDX, TypeScript e verificações HTTP com Node.js.

## Contrato e decisões

- O usuário confirmou que o projeto é o CRM e que deseja visibilidade nos buscadores.
- URLs públicas: `/`, `/docs/`, `/privacidade/` e `/termos/`.
- Conversas, contatos, funil, configurações, automações, calendário, e-mail e reuniões continuam autenticados e fora do índice.
- O HTML inicial da home deve conter a apresentação pública mesmo enquanto a sessão é consultada.
- Canonicals e sitemap usam exclusivamente `https://crm.avilaops.com`, com barra final.
- Sem avaliações, preços, depoimentos ou garantias de posicionamento inventados.
- O sitemap não inventa `lastmod`; esse campo é opcional quando não há data editorial confiável.
- `llms.txt` facilita descoberta do conteúdo público; não é requisito de indexação do Google.
- A publicação exige o fluxo de implantação já autorizado para o projeto; um build local não comprova produção. O domínio público está retornando timeout nesta sessão.
- A solicitação de indexação não inclui instalar novos rastreadores ou alterar credenciais.

## Execução

- [x] Criar verificação HTTP e observar falha da home bloqueada ou sem apresentação no HTML.
- [x] Implementar metadados públicos, layouts internos e conteúdo inicial sem dependência da sessão.
- [x] Publicar endpoints locais de sitemap, robots e llms; adicionar dados estruturados públicos e canonical por página.
- [x] Executar tipos, lint, testes pertinentes, build e verificação do servidor de produção local.
- [x] Revisar o diff, conferir produção e registrar evidências e limitações no controle da equipe.

## Foco da revisão

- Nenhuma URL com IDs de conversas ou reuniões entra no sitemap.
- Nenhum grupo interno perde o `noindex` herdado de seu próprio layout.
- Nenhum dado de sessão entra nos metadados, sitemap, llms ou JSON-LD.
- Uma falha de autenticação mantém a apresentação pública acessível.
- Endereços inexistentes continuam retornando 404.

## Evidências de execução

- RED: a home retornava somente o estado de carregamento; a asserção do conteúdo público falhou antes da alteração.
- GREEN: os seis testes HTTP passaram em desenvolvimento e no servidor de produção local, incluindo os dez grupos internos.
- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado, com 16 avisos nos arquivos existentes.
- `npm run test:web`: 69 testes aprovados.
- `npm run build`: aprovado, com as quatro páginas públicas e as rotas de descoberta pré-renderizadas.
- `npm run test:seo`: seis testes aprovados em `http://127.0.0.1:5183`.
- Navegador: desktop, celular e transição autenticada com respostas controladas aprovados; sem erros de execução ou hidratação. Relatório em `output/public-seo-browser-results.json` e capturas `output/public-seo-desktop.png` e `output/public-seo-mobile.png`.
- O primeiro harness usava `networkidle2` e respostas 401 para dados de teste, provocando a recarga prevista para sessão expirada. O teste final usa condições de interface e respostas 503 para indisponibilidade do backend; nenhum ajuste adicional no produto foi necessário.
- Revisão estática independente concluída sem achados no escopo de SEO e herança dos metadados.
- Produção: conexão HTTPS com timeout e DNS apontando para a origem. Sem commit, push, deploy ou submissão ao Search Console; a atualização pública permanece pendente de disponibilidade do servidor.
