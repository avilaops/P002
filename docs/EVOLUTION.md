# WhatsApp Web por QR Code

O caminho padrão em Configurações → Canais → WhatsApp é o QR da Evolution API v2. A instância é criada ao conectar pela primeira vez, com nome `crm_<UUID da empresa sem hífens>`. Usuários da mesma empresa usam a mesma conexão; empresas diferentes recebem instâncias diferentes. Somente administradores e gerentes podem parear ou iniciar sincronização manual.

Configure `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` e `EVOLUTION_SYNC_ENABLED=true` no backend. A chave fica no ambiente do servidor. Não use variáveis `NEXT_PUBLIC_*`. Para consultar um serviço privado hospedado em outro servidor, use túnel SSH; para a instalação no próprio computador, use o endereço local descrito abaixo. Em produção a API pode ser acessada pela rede Docker autorizada.

`EVOLUTION_TENANT_ID` e `EVOLUTION_INSTANCE_NAME` são opcionais e restringem o serviço a uma única empresa quando for necessário reaproveitar uma instância legada. Deixe ambos vazios para o padrão de múltiplas empresas.

## Fluxo

1. Entre no CRM como administrador ou gerente e abra Configurações → Canais → WhatsApp.
2. Clique em Gerar QR Code. Se houver pareamento em andamento, o código é recuperado automaticamente.
3. No celular, abra Aparelhos conectados → Conectar aparelho e leia o QR real da Evolution. O CRM verifica/atualiza o código a cada 20 segundos; também é possível usar Atualizar código agora.
4. O estado muda automaticamente para conectado após a Evolution confirmar o pareamento. O cartão mostra o número vinculado quando disponível e oferece acesso à caixa de entrada.

Durante o pareamento, o status é consultado a cada 3 segundos. Nos demais estados, a consulta ocorre a cada 10 segundos. Quando o código ainda está sendo preparado, uma nova tentativa ocorre a cada 5 segundos. As consultas pausam com a página oculta e são canceladas ao sair. Uma falha remove o QR anterior e permite tentar novamente; requisições sem resposta têm limite de 45 segundos. A atualização de 20 segundos não representa um prazo de validade informado pelo provedor.

A configuração mantém a restrição existente a administradores e gerentes. O usuário local Nicolas permanece com papel de atendente.

As rotas são `/api/integrations/evolution/status`, `/connect` e `/sync`. Não aceitam tenant ou nome de instância do navegador: derivam a empresa da sessão. Os endpoints antigos de QR redirecionam para o fluxo novo.

Com a sincronização habilitada, o backend consulta a cada 15 segundos os canais Evolution criados pelo CRM, verifica o estado e importa até 100 registros recentes por ciclo. As mensagens são deduplicadas por empresa e ID externo. O recebimento atualiza o inbox pelo SSE existente. Webhooks de outras aplicações não são alterados.

Este conector importa textos de conversas individuais e legendas de mídia. Grupos, anexos binários e mensagens sem texto não são importados. Não é uma importação completa de todo o histórico. Envios só aparecem como aceitos após receber ID real da Evolution; falhas ficam como falhas no CRM.

## Verificação

`backend/test/evolution.test.mjs` cobre isolamento de empresas, contrato de envio v2, falhas reais, QR fornecido pela API e sincronização idempotente. `test/web/activation.test.ts` garante que o onboarding só reconhece o canal após estado conectado confirmado.

`test/web/evolutionPairing.test.ts` e `test/web/evolutionRequest.test.ts` cobrem apresentação, intervalos, permissões, visibilidade, limite de espera e cancelamento. A verificação no navegador em desktop e celular está registrada em `docs/superpowers/plans/2026-11-14-whatsapp-pairing-experience.md`.

A instância `status` existente no servidor foi preservada. A solicitação de 13/11/2026 escolheu parear outro número para o CRM.

## Instalação nativa neste Windows — 14/11/2026

A Evolution API 2.3.7 está em `%LOCALAPPDATA%/avilaops/evolution-api`, obtida do repositório oficial no commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. Ela usa o banco e o usuário próprios `evolution_local` no PostgreSQL de `127.0.0.1:5432`. As 57 migrações da versão foram aplicadas nesse banco, criando 37 tabelas.

O serviço escuta em `http://127.0.0.1:15434`. A cópia local de `src/main.ts` fixa o endereço de escuta em loopback. A configuração usa cache em memória, com Redis e integrações externas opcionais desabilitados. As sessões e dados do WhatsApp são persistidos pelo PostgreSQL. Telemetria e Sentry estão desabilitados.

A chave local foi gerada para esta instalação e fica no `.env` ignorado da Evolution e no `.env.local` ignorado do CRM. O CRM usa esse serviço com sincronização habilitada. A configuração anterior do CRM foi copiada para `%LOCALAPPDATA%/avilaops/crm-local/backups` antes da alteração.

Com o PostgreSQL local já iniciado, o comando para iniciar a Evolution é:

```powershell
Set-Location "$env:LOCALAPPDATA/avilaops/evolution-api"
npm start
```

O log da execução atual fica em `local-runtime.log` nessa pasta. A geração do QR foi verificada pela rota autenticada de conexão do CRM; o resultado local está em `output/evolution-local-result.json`. O estado `connecting` significa que ainda falta ler o QR no celular. Gerar um QR não comprova pareamento nem envio ou recebimento de mensagens.

Na leitura posterior, ao concluir a melhoria da interface, o estado real era `disconnected`. Para continuar o pareamento, gere um código atual pela configuração do WhatsApp no CRM.
