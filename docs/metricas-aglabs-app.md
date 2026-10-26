# AG LABS App: métricas do modelo de créditos

Produto `aglabs-app` (a chave `aglabs` continua sendo o AG LABS institucional nos contatos). O AG LABS App vende créditos por assinatura mensal ou pacote avulso; não é SaaS por conta. O coletor aceita apenas `https://aglabs.app.br/api/integrations/crm/metrics` (ou `www`) com o token exclusivo do produto em `APP_METRICS_SOURCES`.

No contrato v1, só `metrics.users` é aceito; números de conta SaaS são rejeitados. O bloco opcional `credits` é projetado explicitamente a partir da aba de 30 dias do admin do app:

- `users`: total, ativos em 30 dias e que geraram (ativos e geradores ≤ total);
- `sales`: compras de crédito sem reembolso aprovado, compradores e receita registrada em centavos BRL (compradores ≤ compras; zero compras sem valor);
- `subscriptions`: ativas, em teste, MRR estimado e ativas por plano conhecido (Básico, Advanced, Premium); seção `null` quando indisponível. `mrrCents` pode ser `null` quando faltam preços, sem zerar as contagens conhecidas;
- `credits`: vendidos, comprados, bônus (pode ser `null`), consumidos e reembolsados; `null` quando indisponível;
- `generations`: gerações no período.

Rankings, e-mails, nomes e pedidos nunca atravessam o CRM. Receita registrada não é liquidação. A versão do app sem o bloco continua aceita. A tela Ecossistema mostra o cartão; `crm_metricas_produto` leva a mesma projeção para a Órbita. Ativação: `CRM_METRICS_TOKEN` no Render do app e o mesmo valor na entrada `aglabs-app`; conferir com o admin antes de declarar integrado.
