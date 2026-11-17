# Caixa WhatsApp • mídia, avatares e transcrição

## Objetivo

Deixar a caixa de entrada próxima da leitura cotidiana do WhatsApp, com foto do contato, prévia leve de imagens e vídeos, reprodução de áudio e transcrição pesquisável de áudio e vídeo.

## Arquitetura

• O PostgreSQL mantém metadados, transcrição e uma fila durável com tentativas, lease e erro final.

• O R2 privado mantém originais, miniaturas e avatares em chaves isoladas por empresa e conversa.

• A importação da Evolution apenas persiste a mensagem e enfileira o processamento. Ela não espera FFmpeg nem Whisper.

• Um processo `media-worker`, executado a partir da mesma imagem do CRM, reivindica um item por vez com `FOR UPDATE SKIP LOCKED`, gera miniaturas pelo FFmpeg e envia o áudio normalizado a um serviço Speaches compatível com a API da OpenAI.

• O serviço Speaches usa Faster Whisper Base em CPU, tem limite próprio de memória e não recebe tráfego público.

## Dados

`contacts` recebe a referência privada do avatar e a data da última tentativa. `message_media` recebe a referência da prévia, estado de processamento, transcrição, idioma e erro. `media_processing_jobs` controla processamento idempotente por mídia.

O endpoint de avatar e os endpoints de mídia continuam autenticados e verificam `tenant_id`. URLs externas da Evolution nunca são entregues ao navegador nem guardadas como fonte definitiva.

## Fluxo

1. A Evolution entrega ou lista uma mensagem.
2. O CRM grava original e metadados e cria o job na mesma transação.
3. O worker lê o original do R2 para um diretório temporário.
4. Imagem recebe miniatura JPEG; vídeo recebe poster JPEG e faixa de áudio; áudio recebe normalização mono em 16 kHz.
5. Áudio normalizado é transcrito automaticamente quando o Speaches está configurado.
6. O worker grava resultados, publica `message.updated` e remove temporários.
7. A tela atualiza prévia e transcrição sem recarregar a conversa.

## Interface

• Avatar circular na lista e no cabeçalho, com iniciais como fallback.

• Fundo discreto de conversa, cabeçalho compacto e bolhas verde-claro para mensagens enviadas e brancas para recebidas.

• Imagem abre o original, mas carrega a miniatura primeiro.

• Vídeo mostra poster e controles nativos.

• Áudio usa um cartão compacto e exibe a transcrição logo abaixo.

• Estados de processamento e falha ficam visíveis sem ocultar o anexo original.

## Limites e segurança

• Nenhum binário é armazenado no PostgreSQL.

• Download de avatar aceita apenas HTTPS, tamanho e tipo de imagem limitados.

• Jobs têm número máximo de tentativas e lease recuperável após reinício.

• Temporários são criados fora do repositório e apagados em `finally`.

• A interface mantém acessibilidade, foco, nomes alternativos e comportamento responsivo existentes.

## Fora do escopo

Chamadas, status efêmero, reações, figurinhas animadas e edição de mídia não fazem parte desta entrega.
