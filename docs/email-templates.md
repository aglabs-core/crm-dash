# Modelos visuais para campanhas

O CRM mantém **uma base visual Barberias e uma base visual AG LABS institucional** em Campanhas → Templates de e-mail. A identidade é reutilizada; a mensagem é escrita por Antonio ou pelo agente para o contexto e o destinatário de cada campanha. Os textos da prévia apenas demonstram o espaço do conteúdo e não fazem parte do HTML copiado ou baixado.

Os 14 exemplos transacionais do Barberias foram retirados desta biblioteca. Continuam pertencendo ao sistema do produto; não são modelos de prospecção do CRM. O pedido de avaliação da AG LABS deu origem à identidade da base institucional, sem manter uma finalidade, cliente, assinatura pessoal ou link de avaliação obrigatório.

## Campos das duas bases

| Campo | Uso |
|---|---|
| `{{preheader}}` | Resumo da mensagem na caixa de entrada |
| `{{categoria}}` | Identificação breve da comunicação |
| `{{titulo}}` | Título do conteúdo; o assunto da campanha é revisado separadamente |
| `{{mensagem}}` | Texto livre, personalizado para a pessoa e o objetivo |
| `{{texto_acao}}`, `{{url_acao}}` | Botão opcional e seu destino |
| `{{assinatura}}` | Responsável e identificação da marca |
| `{{rodape}}` | Contexto do contato e informações necessárias da campanha |

Copiar/baixar entrega a base com esses campos. Quem prepara a comunicação substitui os valores com escape de HTML; quebras de linha de mensagem e assinatura viram `<br>`. O bloco entre `CTA_START` e `CTA_END` deve ser removido quando não houver botão. Não inserir HTML arbitrário no lugar do texto nem usar URLs fora de HTTP/HTTPS. O renderizador de prévia em `lib/email-templates.ts` exemplifica esse contrato e rejeita ações inválidas.

Os catálogos `lib/email-templates/barberias.json` e `lib/email-templates/aglabs.json` são mantidos no CRM. A base Barberias preserva logo, paleta, cabeçalho e rodapé da marca; a institucional preserva a composição fornecida pelo responsável da AG LABS. Novos textos de campanha não exigem criar outro template. Adicionar outra base apenas quando houver uma composição visual realmente diferente.

## Fluxo operacional

1. Revisar contatos e o contexto da abordagem no CRM, respeitando bloqueios e descadastros.
2. Criar uma campanha e selecionar somente o público revisado do produto.
3. Escrever a mensagem adequada ao destinatário; consultar a base da marca pela etapa Mensagem, em uma aba separada para preservar o rascunho.
4. Revisar mensagem, remetente, destinatários e aprovação; usar o provedor para entrega conforme o contrato aprovado.

A preparação e a fila de aprovação atuais congelam **texto e destinatários**, conforme `docs/campaign-approval.md`. Copiar uma base não vincula HTML à campanha, não aprova uma mensagem e não envia e-mail. Incorporar HTML ao executor exige congelar também a base, sua versão e o resultado personalizado na mesma aprovação. A estrutura do CRM permanece a referência para uma futura integração por MCP, que deve usar esses contratos e a mesma audiência.

## Prévia

HTML e texto, com largura de desktop/celular, usam apenas dados demonstrativos. O iframe mantém `sandbox=""`, `referrerPolicy="no-referrer"`, CSP restritiva e links sem destino. Apenas imagens das marcas e estilos inline são permitidos. Nenhum contato real é incorporado ao catálogo ou consultado para essa prévia.
