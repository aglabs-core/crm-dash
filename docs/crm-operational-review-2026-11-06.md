# Revisão operacional e fiscal — 06/11/2026

## Resultado desta etapa

Sincronização por fast-forward de `65989c5` para `88ba059` de `origin/main`, preservando `supabase/.temp/` preexistente. Implementação na branch `codex/organizacao-operacional-fiscal`.

- `/operations`: distribuição exclusiva de contatos entre base fria, qualificação, funil, clientes e arquivados; qualidade cadastral; mapa das áreas e rotina diária/semanal/mensal. Consulta apenas agregados da view existente, respeitando RLS.
- `/finance`: pagamentos por mês de recebimento em São Paulo e produto; valores originais, devoluções acumuladas e saldo após devoluções/contestações antes de taxas; conferência de contato, produto, data, moeda e devoluções. Paginação visual de 25 linhas. Sem exportação, nomes, documentos, endereços ou identificadores externos na listagem.
- Correção de `loadPaymentTransactions`: continua até página vazia, avançando pelo tamanho realmente recebido. O limite efetivo do servidor pode ser menor que 500; parar na primeira página curta subestimava totais. Cancelamento no unmount evita respostas atrasadas na nova página.

Não há mudança de schema, migração de contatos, reclassificação, nova permissão de MCP, disparo, cobrança ou emissão de nota. A situação fiscal continua **desconhecida**, pois o CRM não tem fonte de documentos fiscais. Ausência de pendência cadastral não significa regularidade fiscal.

## Revisão das áreas e prioridades

| Área | Base atual verificada no código | Lacuna / próximo incremento | Prioridade |
| --- | --- | --- | --- |
| Base fria | `contacts.prospecting_pool`, elegibilidade de abordagem, filtros/paginação | Revisar origem, produto, duplicidade entre canais e bloqueios; sem promover por envio automático | Alta |
| Entradas | `leads_institucional`, conversão atômica existente | Rotina de triagem e conferência da atribuição efetiva ao agente | Alta |
| Comercial | Estágio exclusivamente em `contacts.status`; tarefas e contexto no funil | Contratações simultâneas/recorrentes não cabem em um único `amount`; criar modelo de serviços sem duplicar o estágio | Alta |
| Apps | Conta e métricas por produto separadas do funil | Contato não é pessoa única entre canais, usuário único nem empresa única; revisar mapeamento de identidade antes de automações | Alta |
| Comunicação | Ledger, campanhas, aprovação e executores existentes | Validar operação autenticada, supressão e respostas antes de habilitar novas cadências | Alta |
| Recebimentos | `payment_transactions`, gateways e fontes manuais `pix`/`99freelas` | Conciliação bancária, taxas, liquidação e competência fiscal ainda ausentes | Alta |
| Fiscal | Sem cadastro/arquivo fiscal persistente no modelo versionado | Serviços, tomador fiscal, documentos e fechamento mensal; emissão pelo provedor oficial | Imediata |
| Despesas e sócio | Sem razão de despesas/aportes | Identificar pagador e comprovante desde já; contador define aporte, mútuo ou reembolso | Alta |
| Gestão/IA | `/actions`, `crm_prioridades`, MCP com escopos | Começar por recomendações justificadas com data/fonte; revisão humana antes de contato | Após saneamento |

### Limites de indicadores encontrados

`payment_transactions.net_amount` é `amount - refunded_amount`: não desconta taxas, tributos nem prova liquidação bancária. Os rótulos “receita líquida” preexistentes em relatórios/MCP precisam de revisão de contrato antes de alterar sua semântica. A nova área explicita a limitação.

Os relatórios históricos agrupam datas por fuso do navegador em alguns caminhos (`paymentMonthRevenue`); a nova área usa São Paulo explicitamente. Uma migração uniforme desses indicadores requer testes de fronteira e alinhamento com Órbita.

Pagamentos selecionados pelo mês original incluem a devolução acumulada atual. Isso não responde quanto foi devolvido no mês da devolução: exige eventos financeiros com sua própria data. As contagens de carteira são contatos e incluem clientes ativos/inativos juntos; não substituem MRR, churn ou clientes pagantes únicos.

## Modelo recomendado para o próximo incremento fiscal

Implementar um controle interno enxuto, integrado ao emissor oficial; não construir um motor tributário próprio. A emissão manual validada vem antes da API.

1. **Serviços/contratações:** descrição, cliente, valor contratado, data de prestação/competência, aceite e condições de cobrança. Parcelas e pagamentos separados. A posição no funil continua somente em `contacts`.
2. **Documentos fiscais:** serviço, tomador fiscal validado, valor bruto fiscal, competência, emissor, identificador/chave, data de autorização, status real do provedor e cancelamentos/substituições. Número de nota não comprova autorização sozinho.
3. **Vínculos de pagamentos:** permitir vários pagamentos para um serviço e várias notas conforme orientação fiscal. Não impor uma nota por webhook ou usar `net_amount` como base tributária.
4. **Documentos privados:** XML original, representação PDF, contrato/aceite, comprovantes e extratos em Storage privado, com RLS por proprietário e URLs temporárias. Nunca URLs públicas nem anexos fiscais no MCP.
5. **Despesas e financiamento:** categoria, competência, fornecedor, valor, moeda/câmbio documentado, pagador PF/PJ, comprovante e eventual reembolso. Separar custo operacional de entrada de capital e impedir dupla contagem.
6. **Fechamento por competência:** recebimentos conciliados, notas/documentos, despesas, aportes, pendências, entrega ao contador e recibos de apuração. Preparar arquivo contábil privado apenas quando expressamente solicitado; não implementar exportação geral de leads.

Schema futuro: FKs devem impedir vínculos entre proprietários, além da RLS da linha; grants explícitos, trilha de autoria, controle de concorrência e nenhuma chave privilegiada no navegador. Estados internos de revisão não se confundem com autorização da SEFIN. Não inferir “dispensada” por valor baixo ou por cliente PF.

### Automação fiscal posterior

Após validar manualmente cadastro e primeira emissão: evento comercial elegível → rascunho fiscal → validação do responsável → envio server-side ao emissor/API → consulta da autorização → armazenamento privado → vínculo ao serviço → conciliação. Usar chave idempotente por operação fiscal, fila/retry e reconciliação após timeout; nunca repetir emissão quando o resultado for incerto. Estorno de gateway não cancela automaticamente NFS-e. Certificados e credenciais exclusivamente no servidor. Comparar API nacional direta com provedor integrado somente depois de confirmar requisitos, volume e custo; não contratar integração nesta etapa.

## Serviço anterior sem nota

Informação fornecida pelo usuário: desenvolvimento web e página adicional, total de R$ 300, prestados no mês anterior. Não foi criado lançamento fictício nem presumido pagamento, cliente, data exata ou emissão.

Levantar data de prestação, contratação, tomador, recebimento e comprovantes; confirmar regime/CNAE/código de serviço com a contabilidade. Se a competência for outubro/2026, conferir a regularização retroativa no emissor municipal correspondente. Não trocar competência para novembro apenas para conseguir emitir. Confirmar se os itens integram a mesma prestação antes de decidir uma ou mais notas. Emitir nota não substitui apurar eventual obrigação anterior, juros ou retificação.

### Fontes oficiais consultadas em 06/11/2026

- [Portal NFS-e — orientação de 29/10/2026](https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/): ME/EPP optantes pelo Simples usam o Emissor Nacional para competências desde 01/11/2026; competência anterior em município com emissor próprio segue o fluxo retroativo municipal. A atualização substitui a comunicação antiga que citava setembro.
- [Rio Verde — cadastro e emissão](https://www.rioverde.go.gov.br/servico/nota-fiscal/): ponto de entrada municipal para confirmar cadastro e regularização anterior.
- [Receita — PGDAS-D](https://www8.receita.fazenda.gov.br/simplesnacional/servicos/grupo.aspx?grp=5): transmissão mensal inclusive sem receita. Confirmar opção oficial pelo regime e situação das competências desde a abertura; ausência de venda de apps não equivale a receita total zero se houve serviço.

Não foi consultada a situação fiscal autenticada da empresa. Enquadramento, credenciamento, apuração e dados da operação precisam de validação específica com a contabilidade.

## Verificação e publicação

A tentativa de consulta **somente agregada** ao projeto Supabase do CRM pelo conector foi recusada por permissão. Nenhum contato/pagamento real foi extraído. Esta revisão não representa inventário atual dos dados, teste real dos gateways, emissão NFS-e ou validação autenticada em produção.

Validação concluída:

- `npm ci` alinhou a instalação local ao lockfile (Next `15.5.28`; antes estava instalado `15.5.25`). Nenhuma alteração de dependências/lockfile foi necessária.
- `npm run check` aprovado em cópia limpa com instalação independente pelo lockfile, sem `.env.local` e sem variáveis públicas do Supabase: lint, typecheck, 191 testes de lógica/banco, 58 testes de interface e build. Somente `.env.example`, sem credenciais, foi incluído para o teste de contrato da release.
- `npm run audit:gate` aprovado nessa cópia: zero alertas, zero exceções.
- `git diff --check` aprovado.
- Revisão React: efeitos com cancelamento, falhas explícitas, filtros rotulados, links internos, tabela com rolagem horizontal e paginação. Não houve inspeção visual autenticada no navegador.

Antes de publicar: revisão do diff e testes autenticados das novas rotas em desktop/mobile. O presente incremento não exige migration. Não foram executadas as suites adicionais de PostgreSQL via Docker do CI; os testes de banco incluídos em `check` usam PGlite. Nenhuma execução remota de CI, merge ou deploy é comprovada por estes gates locais. Separar aprovação de código, merge, deploy e comprovação funcional.
