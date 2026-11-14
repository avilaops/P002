# P002 • descoberta pública

O produto deve ser encontrado nos buscadores. A apresentação pública é entregue no HTML inicial, inclusive enquanto o navegador confere a sessão.

## Endereços públicos

- `https://crm.avilaops.com/`
- `https://crm.avilaops.com/docs/`
- `https://crm.avilaops.com/privacidade/`
- `https://crm.avilaops.com/termos/`

Cada página tem título, descrição, canonical, Open Graph, Twitter e dados estruturados próprios. O catálogo em `src/lib/seo.ts` alimenta esses metadados, o sitemap e `llms.txt`.

Os layouts dos dez grupos autenticados mantêm `noindex,nofollow` e removem o canonical da apresentação. Conversas, contatos, calendário, configurações e reuniões não entram no sitemap. A autenticação e as permissões continuam sendo responsabilidade da sessão e do backend.

`public/robots.txt` permite rastreio e anuncia `/sitemap.xml`. O sitemap contém somente as quatro URLs canônicas; não inventa datas de modificação. `llms.txt` aponta para o conteúdo público e não é requisito de indexação do Google.

## Verificação

Com a aplicação em execução:

```powershell
npm run test:seo
```

Para conferir outra instância, ajuste `CRM_SEO_BASE_URL`. Por exemplo, com um servidor de produção local na porta 5183:

```powershell
$env:CRM_SEO_BASE_URL = 'http://127.0.0.1:5183'
npm run test:seo
```

O teste confere HTML inicial, metadados das quatro páginas públicas, os dez grupos internos, sitemap, robots, llms e 404. Ele só faz requisições de leitura.

## Publicação

O fluxo vigente está em `docs/OPERACAO.md`; não usar os scripts antigos de `/opt/agenda-crm`. A primeira verificação de 14/11/2026 retornou timeout. Na reconexão solicitada pelo usuário, o SSH voltou a responder e `/api/health` retornou HTTP 200 com banco conectado. O acesso central também respondeu HTTP 200.

A versão pública verificada nessa reconexão é `b8e6fa5c150981a270416c4981f4aee715c75b63`: ainda retorna `noindex,nofollow` e HTTP 404 em `/sitemap.xml`. As correções deste documento estão verificadas localmente e aguardam implantação.

Após implantar e confirmar as respostas HTTP do domínio, enviar `https://crm.avilaops.com/sitemap.xml` na propriedade do Search Console e verificar a inspeção da home. A indexação e o posicionamento dependem dos buscadores.

## Ambiente local • servidor online

Na reconexão de 14/11/2026, `CRM_API_ORIGIN` em `.env.local` foi ajustado de `http://127.0.0.1:3004` para `https://crm.avilaops.com`. O processo local foi reiniciado para atualizar os rewrites. As configurações do PostgreSQL local foram preservadas.

O frontend em `http://127.0.0.1:5173` consulta agora a API online do P002. Os links de entrada e cadastro usam o acesso central e retornam ao domínio público. O teste real no navegador confirmou os botões e a conclusão do carregamento, sem respostas simuladas nem login de usuário automatizado.

Evidências: `output/P002-server-reconnect-results.json` e `output/P002-server-reconnected.png`. O backup anterior da configuração está fora do repositório, em `C:/Users/nicol/.codex/backups/P002-env-local-before-server-20261114-141427.env`.
