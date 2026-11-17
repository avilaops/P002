# Revisão integral da interface do CRM

## Intenção

Tornar Canais, Integrações e Caixa de entrada mais claras, densas e responsivas sem alterar os contratos de backend nem os fluxos de autenticação e isolamento por empresa.

## Objetivos

• Canais terá somente pontos de entrada e saída de conversas.

• Integrações terá somente sistemas que trocam dados ou publicam conteúdo.

• Todos os estados terão texto explícito, ação primária e resumo operacional.

• A Caixa de entrada esconderá identificadores técnicos, priorizará identidade humana, limitará a largura de leitura e oferecerá compositor e painel de contato claros.

• As três telas funcionarão em celular, tablet e desktop, com foco visível, alvos mínimos de 44 px e informação que não dependa apenas de cor.

## Não objetivos

• Alterar APIs, banco, sincronização da Evolution ou regras da janela de 24 horas.

• Criar integrações que ainda não existem.

• Trocar o design system, bibliotecas ou navegação do produto.

## Restrições

• Next.js 16.4.5 com App Router, React 19.2.7, Tailwind CSS 4.3.3, Motion e Lucide já instalados.

• Textos do produto usam `•` como separador.

• Identificadores `@lid` nunca serão apresentados como nome ou telefone.

• Ações atuais de conexão, atribuição, arquivamento, criação de lead, mídia e envio serão preservadas.

## Abordagens consideradas

### Ajuste visual apenas

Menor risco, mas preservaria duplicações e identificadores técnicos. Rejeitada.

### Reconstrução completa das telas

Permitiria uma composição nova, mas aumentaria risco sobre fluxos produtivos já verificados. Rejeitada.

### Evolução dos componentes existentes

Selecionada. Mantém contratos e comportamentos, remove duplicações, extrai regras de apresentação testáveis e reorganiza o layout responsivo.

## Desenho

### Canais

Resumo de saúde no topo, quatro canais canônicos e regras de atendimento. Cada canal mostra estado, contexto e uma ação explícita.

### Integrações

Lista exclusiva de Threads, Messageria Ávila Ops, ERP Ávila Ops, Google Agenda, n8n e Pagamentos. O estado carregando será textual e nenhum item usará `---` ou reticências como estado.

### Caixa de entrada

Lista de 340 px em telas grandes, área de conversa flexível e conteúdo centralizado em até 860 px. Identidade do contato usa nome, telefone válido ou `Contato sem nome`. Sincronização vira barra compacta, contadores acionam filtros, mensagens recebem divisores por dia e status acessível, e o compositor permanece fixo e completo.

### Responsividade

Configurações reduz a coluna de categorias em larguras intermediárias. Caixa de entrada mantém navegação em pilha no celular, duas colunas em tablet e abre detalhes do contato em drawer sob demanda.

## Verificação

• Testes unitários das regras de apresentação.

• Typecheck, lint, testes web e build.

• Navegação real em Canais, Integrações e Caixa de entrada nos tamanhos 390×844, 960×900 e 1440×900.

