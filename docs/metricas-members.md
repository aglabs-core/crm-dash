# Members: métricas de marketplace

Members é marketplace, não SaaS por conta: a unidade de negócio é o produtor e a receita da plataforma vem das vendas (produtos próprios e comissões). O coletor aceita apenas `https://members.ia.br/api/integrations/crm/metrics` (ou `www`), com o token de `APP_METRICS_SOURCES` exclusivo do produto.

No contrato v1, só `metrics.users` é aceito para `members`; os demais campos de conta precisam ser `null` e o CRM rejeita números SaaS. O bloco opcional `marketplace` é validado e projetado explicitamente:

- `currentMonth` e `previousMonth`: faturamento bruto, receita da plataforma e vendas pagas, do mesmo relatório (`get_platform_financial_report`) que o painel `/plataforma` do Members; meses consecutivos no fuso de São Paulo, e o mês corrente começa no início da janela;
- `producers`: cadastro iniciado e aprovados (aprovados ≤ iniciados ≤ usuários);
- `users`: total de perfis e novos em 30 dias, igual a `metrics.users`.

Receita da plataforma não pode passar do bruto; venda zero não tem valor. Valores em centavos BRL. No relatório canônico, a receita usa alocações da plataforma e de produtos próprios, conciliadas quando disponíveis ou estimadas, menos estornos alocados. O legado usa o valor líquido do produto próprio ou a comissão registrada de terceiros. Portanto não afirmar que taxas nunca foram descontadas nem que os valores comprovam liquidação bancária ou saldo disponível. A versão do app sem o bloco continua aceita.

A tela Ecossistema mostra esses indicadores no cartão do Members; `crm_metricas_produto` transporta a mesma projeção para a Órbita. Ativação: `CRM_METRICS_TOKEN` no Members e o mesmo valor na entrada `members` de `APP_METRICS_SOURCES` do CRM; conferir com o painel `/plataforma` antes de considerar integrado.
