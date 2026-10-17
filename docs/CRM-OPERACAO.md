# Organização operacional do CRM

## Cadastro e qualificação

Contato é a ficha da pessoa e a única unidade do funil. WhatsApp, e-mail, comentário e pedido de material entram como Contato, fora dos indicadores comerciais. Prospecção é a base fria, representada por prospecting_pool=true e status Arquivado; não conta como perda. Lead exige interesse comercial identificado. Contatado significa abordagem comercial enviada; Atendimento é conversa comercial, Proposta é oferta concreta enviada e Pagamento é cobrança combinada. Clientes não retornam a Lead ou Contato por nova demanda.

No n8n, CRM - Registro seguro da Maia aceita conversas gerais sem produto. Para avançar comercialmente, o chamador fornece commercial_intent=true, qualification_reason com 10 a 500 caracteres, product e status comercial explícito. A razão é anexada à atividade; mensagens com dados sensíveis são rejeitadas. Uma conversa genérica não altera a etapa existente de um cliente ou uma oportunidade já trabalhada. O intake preserva nome nulo até ser informado e grava o número no campo whatsapp, agora exibido pela interface.

Instagram continua usando registrar_lead_instagram, com deduplicação por evento; solicitação de material não é compra ou oportunidade qualificada. O produto associado à palavra-chave é contexto de interesse, não autorização comercial. Após entregar o material solicitado, uma pergunta contextual possível é: “Você pretende usar isso no seu negócio ou está explorando por enquanto?”. Nenhuma mensagem foi enviada durante a revisão.

## Pagamentos e reembolsos

payment_transactions é a fonte financeira. Receita exibida é o valor líquido de estornos, não saldo bancário ou margem após taxas. Reembolsos reduzem a venda original por paid_at; o gráfico não é fluxo de caixa por data do estorno. O funil acumulado é estimado pelo estágio atual e não comprova passagem histórica por todas as etapas.

A ingestão calcula o relacionamento após o merge monotônico da transação. Reembolso integral sem outra compra válida resulta em Inativo; replay antigo de paid não reativa esse cliente. Outra compra válida mantém Cliente. Acesso ao produto continua sob responsabilidade do produto, não do CRM.

Asaas: os eventos PAYMENT_REFUNDED e PAYMENT_PARTIALLY_REFUNDED passam a ser processados. A API do pagamento é reconsultada; somente refunds com status DONE compõem o total devolvido. PENDING e CANCELLED não são estorno concluído. Eventos inconsistentes falham em vez de voltar a paid. O mapeamento está em integrations/n8n/asaas-payment.js e os parâmetros publicados estão versionados em workflow-updates.json. Referências: https://docs.asaas.com/docs/refunds e https://docs.asaas.com/docs/payment-events.

## Implantação e evidência

Em 17/10/2026, após autorização explícita para implantação, foram aplicadas as migrations add_unqualified_contact_stage e correct_intake_qualification_and_refund_lifecycle. As funções foram comparadas às definições remotas antes da alteração; assinaturas, grants e isolamento de identidade foram preservados. Três workflows da VPS-03 foram publicados e conferidos ativos, sem persistência de payload em execuções manuais, bem-sucedidas ou com erro: intake WhatsApp, registro da Maia e ingestão de pagamentos. O workflow Instagram tem rascunho diferente da versão ativa; ele foi preservado, e a correção ocorreu na RPC compartilhada.

Uma transação com reembolso confirmado pela administração foi conciliada e verificada com net_amount=0, refunded_amount integral e contato Inativo, preservando a compra. Nove capturas automáticas sem pagamento, tarefa ou registro comercial foram movidas a Contato: seis de Instagram e três de WhatsApp. Registros com atividade adicional foram preservados para revisão contextual.

A verificação remota scripts/verify-crm-lifecycle.sql executou intake, qualificação, e-mail, Instagram e replay de estorno em subtransação com rollback obrigatório. Não conserva contatos, atividades, pagamentos ou eventos sintéticos. Usar a CLI com --file evita truncamento de argumentos multilinha no Windows. Não exportar a carteira ou payloads de provedores como evidência.

## Interface e validação

Contatos têm quatro indicadores, busca por nome/canal e filtros recolhidos. O funil preserva próxima tarefa, responsável e última interação; os filtros avançados ficam em uma janela e as ações do cartão no menu de reticências. Tarefas têm filtro separado da criação e consultas paginadas; falha de consulta não vira zero tarefas. Integrações sai da navegação e redireciona para Campanhas, preservando endpoints Brevo. Campanhas tem uma única ação de criação.

npm run check passou sem .env.local: lint, TypeScript, 74 testes de lógica/banco, 31 testes de interface e build. O arquivo de ambiente foi restaurado. npm run audit:gate passou sem avisos e sem exceções. Validação autenticada final ocorre após o deploy; confirmação de entrega futura de webhook exige um evento real do provedor.
