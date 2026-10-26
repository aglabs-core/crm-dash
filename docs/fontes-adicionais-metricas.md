# Acrescentar fontes sem substituir um segredo existente

Quando `APP_METRICS_SOURCES` já está salvo como Secret na Vercel, o valor não pode ser revelado. Não substituir a lista por uma reconstrução presumida nem copiar os tokens para uma variável pública.

`APP_METRICS_SOURCES_EXTRA` aceita o mesmo formato JSON (lista de `{ product, url, token }`) e é concatenado em memória à configuração original. Salvar exclusivamente como Secret de produção. As origens fixas, HTTPS, tamanho, timeout e projeção de dados continuam iguais. Não modificar ou apagar `APP_METRICS_SOURCES` ao adicionar fontes aqui.

Um produto presente mais de uma vez nas duas listas retorna indisponível, sem fazer requisição: não há substituição silenciosa de token/destino. Os demais produtos únicos continuam disponíveis. Se uma das configurações não for uma lista JSON válida, a consulta falha; nenhum zero é presumido. A configuração não muda contatos ou permissões do CRM.

Ao adicionar outro produto, preservar as entradas da lista complementar também. Mudanças exigem um novo deployment de produção e comparação com o painel do app antes de concluir a tarefa operacional.
