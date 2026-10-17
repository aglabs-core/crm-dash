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

A nota `02 - Estrutura Interna/Atendimento/Arquitetura - Suporte por E-mail.md` do vault empresarial documenta o uso do template institucional pela Maia. O HTML original não estava nos arquivos consultados do vault ou do site institucional. A entrada está identificada como pendente e não apresenta um layout inventado como se fosse o aprovado. Para disponibilizá-la, importar o original com dados fictícios e registrar sua origem e versão.

## Isolamento da prévia

O iframe usa `sandbox=""`, `referrerPolicy="no-referrer"` e CSP que bloqueia scripts, formulários, conexões e recursos externos, exceto imagens do domínio da marca Barberias e estilos inline. Os links ficam sem destino na prévia. O HTML baixado é o exemplo original, sem a CSP adicional ou a remoção de destinos usadas apenas na prévia. Nenhum contato real é inserido nos exemplos.

A fila de aprovação existente continua congelando o **texto da campanha**. Os modelos da biblioteca ainda não integram esse contrato: usar um layout em um executor futuro exige incluir HTML, personalização e versão na mesma aprovação. Não há associação implícita pelo nome do produto.
