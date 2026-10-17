# Biblioteca de templates de e-mail

A aba **Campanhas → Templates de e-mail** reúne os modelos por produto, com seleção lateral, busca, prévia desktop/celular e alternativa em texto. A consulta é independente de campanhas, destinatários e aprovação. Os exemplos usam dados fictícios; copiar ou baixar o HTML não altera uma campanha nem envia mensagens.

## Barberias

Os 14 exemplos foram importados da galeria `output/emails` do projeto Barberias, gerada pelo próprio `scripts/preview-emails.cjs`. Incluem teste grátis, convites, recuperação e ativação de acesso, agendamentos, recorrência e solicitação de cadastro. O HTML e a versão em texto foram preservados, com datas, preços e links fictícios tal como na galeria. Não representam ofertas comerciais vigentes.

O catálogo `lib/email-templates/barberias.json` registra a revisão consultada, os arquivos de origem e o SHA-256 do renderizador. É uma fotografia dos exemplos, não uma sincronização com os envios em produção. A manutenção do layout continua no produto. Para atualizar depois de gerar e conferir a galeria na origem:

```powershell
node scripts/import-barberias-emails.mjs 'CAMINHO_DO_PROJETO_BARBERIAS'
```

O importador lê arquivos locais, sem carregar `.env`, instanciar provedores ou executar o script de envio do produto. A galeria é carregada em um chunk separado apenas ao abrir a biblioteca.

## AG LABS institucional

O responsável pela AG LABS forneceu diretamente o HTML institucional de **pós-entrega e pedido de avaliação**, agora mantido em `lib/email-templates/aglabs.json`. Foram preservados layout, logo, cores, conteúdo, assinatura de relacionamento e link de avaliação do Google. O modelo de pós-entrega não é apresentado como se fosse um modelo genérico de suporte da Maia.

Nome da cliente, empresa e endereço do projeto foram substituídos pelos campos `{{nome}}`, `{{empresa}}`, `{{url_pagina}}` e `{{dominio_pagina}}`. O HTML copiado ou baixado conserva esses campos para reutilização; a prévia os preenche com dados fictícios escapados e um domínio `.invalid`. O catálogo não armazena os dados reais fornecidos no exemplo. A versão em texto acompanha o mesmo conteúdo.

Os blocos opcionais do link da página e da chamada para avaliação mantêm os comentários de remoção do original. O link de avaliação é o endereço empresarial fornecido pelo responsável, com navegação desativada na prévia.

## Isolamento da prévia

O iframe usa `sandbox=""`, `referrerPolicy="no-referrer"` e CSP que bloqueia scripts, formulários, conexões e recursos externos, exceto imagens dos domínios das marcas Barberias e AG LABS e estilos inline. Os links ficam sem destino na prévia. O HTML baixado conserva o modelo e seus campos, sem a CSP adicional ou a remoção de destinos usadas apenas na prévia. Nenhum contato real é inserido nos exemplos.

A fila de aprovação existente continua congelando o **texto da campanha**. Os modelos da biblioteca ainda não integram esse contrato: usar um layout em um executor futuro exige incluir HTML, personalização e versão na mesma aprovação. Não há associação implícita pelo nome do produto.
