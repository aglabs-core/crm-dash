# VibeKit: métricas operacionais

VibeKit é uma compra única, não uma conta SaaS. O coletor aceita exclusivamente `https://templates.aglabs.ia.br/api/integrations/crm/metrics`, por HTTPS, sem redirect, query, porta customizada ou credencial na URL. A resposta é limitada a 32 KiB, oito segundos e projeção explícita de agregados.

Para ativar depois da publicação/migration do VibeKit, incluir uma entrada `product: vibekit`, `url` acima e `token` independente de pelo menos 32 caracteres em `APP_METRICS_SOURCES`, somente no servidor do CRM. O mesmo segredo vive em `CRM_METRICS_TOKEN` no VibeKit. Preservar as entradas dos demais produtos. Sem essa configuração, a tela mostra coleta pendente; falhas não viram zero.

O snapshot v1 preserva produto, geração, janela e `commerceFunnel`:

- eventos anônimos por tipo, sem pessoas únicas ou um denominador comum; não calcular conversão entre etapas;
- início observado da coleta e eventos nulos quando não há cobertura;
- compras registradas com Checkout ID live na janela, excluindo fixtures test;
- acessos provisionados por compra, sem identificar compradores;
- valor BRL registrado em checkout, sem taxas/estornos: não é receita líquida ou liquidada;
- oito métricas de contas/usuários/assinaturas nulas. O CRM rejeita números SaaS inventados para esse produto.

A tela Ecossistema mostra essas unidades separadas. A ferramenta já existente `crm_metricas_produto` transporta a mesma projeção para a Órbita em seu escopo de leitura. Nenhuma ferramenta ou privilégio novo; sem criação de contato, promoção a Cliente, e-mail ou alteração da automação de compra.

Esta entrega prepara código e configuração; não configura segredos, não aplica a migration do VibeKit e não comprova coleta em produção. Conferir as duas publicações e comparar uma navegação controlada com a origem antes de marcar a tarefa como concluída. O navegador local está desativado no Work; testes DOM não equivalem a validação visual autenticada.
