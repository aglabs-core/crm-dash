# Processo fiscal dos aplicativos — 06/11/2026

## Modelo comercial confirmado pelo proprietário

| Aplicativo | Receita da AG LABS neste escopo | Separação necessária |
| --- | --- | --- |
| Barberias | Plano de uso do sistema | As vendas registradas pela barbearia são relatórios do usuário, sem movimentação financeira pela plataforma; não entram na receita nem na emissão da AG LABS |
| Viajeki | Plano de uso da aplicação | Não presumir venda de viagens ou intermediação turística |
| MeCard | Plano de uso da aplicação | Não presumir split ou venda de terceiros |
| AG LABS App | Plano de uso da aplicação | Custos de IA/infra são custos da operação, separados da venda do plano |
| Members | Taxa da plataforma nas vendas com split; planos de uso, se houver | Valor do produtor não vira automaticamente receita própria da AG LABS; conciliar parcelas do split e responsabilidades documentais com o contador |

Esta definição corrige o planejamento anterior que abrangia genericamente outros fluxos de marketplace. Não é uma alteração de código nos aplicativos nem uma comprovação de configuração fiscal nos gateways.

## O que já existe no CRM local

- `payment_transactions`: dados de pagamentos por gateway e vínculo com contato. Confirmação da ingestão e conciliação continuam necessárias; o dado recebido não é documento fiscal.
- `client_documents` e bucket privado, pendentes de migration remota/ativação: originais anexados manualmente na ficha, vínculo opcional com pagamento e central `/documents`.
- Botão de download sob demanda. O download automático do emissor para o Storage, a fila fiscal e a emissão por API ainda não existem.

## Primeiras notas: processo manual assistido

1. Conferir pagamento, aplicação/plano ou serviço, cliente e data de prestação/competência. Para o serviço de R$ 300, o proprietário confirmou cliente PJ, recebimento na data do lançamento no CRM e contador contratado; a data exata e a competência ainda não foram consultadas. Não preencher com a data de criação da ficha sem verificar o lançamento relevante e o comprovante.
2. Completar o cadastro fiscal e validar com o contador tomador, descrição, código do serviço, regime, retenções e regras de emissão. Valor e nome do comprador enviados pelo gateway, sozinhos, não garantem todos os dados necessários.
3. Verificar se já existe nota válida emitida por gateway/integrador para a mesma operação. Se existir, recuperá-la e vinculá-la; não emitir outra.
4. Emitir manualmente pelo emissor correspondente à competência, quando necessário. Competência anterior a novembro/2026 pode exigir fluxo municipal; não alterar competência para contornar bloqueio.
5. Confirmar autorização no emissor, baixar XML e representação PDF e anexar ambos à ficha do cliente, selecionando o pagamento relacionado. Os arquivos são dois documentos da mesma nota, não duas notas fiscais.
6. Guardar a referência da nota e comprovantes no fechamento. A validação de autorização ainda é manual; o anexo do CRM não prova validade fiscal.

## Automação desejada: servidor para servidor

Pagamento confirmado e reconciliado → identificar operação/ciclo e proprietário → validar dados fiscais → localizar nota existente ou solicitar emissão conforme regra aprovada → aguardar/consultar autorização → baixar XML/PDF no servidor → armazenar privadamente → vincular ao cliente/pagamento/operação → atualizar fila e fechamento.

“Download automático” significa cópia do emissor para o arquivo privado do CRM. Não exige navegador ou computador do proprietário abertos e não força download para o computador do usuário. Acesso humano ao original permanece sob demanda.

### Requisitos antes de ligar

- Validar cadastro do prestador, acesso/certificado ou autorização exigida pela API, regras do contador e uma emissão manual representativa de cada natureza de serviço. Definir qual emissor/integrador será responsável; não contratar nem ativar cobrança fiscal nesta fase.
- Conferir, em cada gateway, o que já chega ao ledger e o que falta de identidade fiscal. Não buscar ou exportar bases de clientes para a elaboração deste plano.
- Garantir identificador de aplicação/plano/ciclo/serviço e snapshot fiscal do tomador na operação. `contacts` continua a única fonte de estágio do funil; snapshot da nota não é uma segunda ficha comercial.
- Resolver explicitamente o proprietário do documento. A permissão administrativa para ver contatos não permite anexar documentos de outro proprietário na interface atual. O trabalhador futuro deve ter escopo técnico definido e validado, sem ampliar o MCP ou o acesso do navegador.
- Modelar operações fiscais e relação com pagamentos: parcelas/retries não podem virar notas duplicadas. UUID de upload não serve como chave de emissão. Chave idempotente deve representar a mesma operação fiscal/ciclo/prestador, conforme regra de emissão aprovada.
- Centralizar o acompanhamento fiscal para todos os gateways, preservando o emissor competente. Não adicionar uma automação isolada por aplicativo que possa emitir novamente pela mesma venda.

### Estados propostos (ainda não implementados)

Separar situação da **emissão** (dados pendentes, em revisão, solicitada, autorizada, rejeitada, resultado incerto, cancelada/substituída) da situação do **arquivo** (pendente de captura, parcial, completo, falha). Nota autorizada cujo PDF não baixou continua autorizada: repetir somente a captura.

### Recuperação e integridade

- Eventos autenticados, assinatura/token do provedor e confirmação pela API oficial antes de concluir a autorização. Webhook isolado não comprova a emissão.
- Persistir solicitação e ID do provedor antes de concluir; após timeout com resultado incerto, consultar/reconciliar antes de reenviar. Um retry de download nunca dispara outra emissão.
- Download por API/hosts previamente permitidos, tamanho/formato limitados e sem seguir URLs arbitrárias recebidas no webhook; verificar vínculo do documento à operação e ao prestador/tomador esperados.
- XML e PDF associados ao mesmo identificador fiscal. Deduplicar por identificador e hash; preservar substituições, cancelamentos e falhas parciais. A validação estrutural de arquivo não substitui consulta de autorização.
- Gravação privada com verificação de conclusão, fila de reconciliação para Storage/banco e trilha de autoria. Nunca registrar XML, CPF/CNPJ, payloads fiscais ou credenciais em logs.
- Estorno, contestação ou cancelamento de plano não cancela automaticamente nota fiscal. Aplicar o procedimento fiscal validado e conservar a trilha.
- Backup privado dos arquivos, teste de restauração, alertas operacionais e conferência do fechamento antes de escalar. Ainda não configurados.

## Custos, resultado e documento fiscal

Separar receitas de planos por produto, taxas do gateway, impostos, despesas diretas e custos compartilhados. Valores financiados pelo sócio devem ter pagador e comprovantes identificados, com classificação contábil definida pelo contador. Enquanto despesas estiverem incompletas, não chamar recebimento após devoluções de lucro líquido.

A nota da venda documenta a operação com o cliente conforme a regra fiscal validada; não é calculada simplesmente subtraindo os gastos do aplicativo. Para Members, o split exige conciliar a parte do produtor e a receita própria da plataforma antes de determinar a documentação de cada parte.

## Fontes

- [Asaas: pré-requisitos, configuração e acompanhamento por webhook](https://docs.asaas.com/docs/emitir-notas-fiscais-automaticamente-para-assinaturas). Exemplo de capacidade, não escolha de provedor nem prova de configuração ativa.
- [Portal NFS-e: competência e transição de novembro/2026](https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/).
