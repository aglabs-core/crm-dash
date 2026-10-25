# Aplicativos → CRM → Órbita

O CRM centraliza a visão comercial e coleta agregados dos aplicativos. `/ecosystem` é exclusiva de administradores do CRM. O JWT é validado no servidor e a associação `admin_users` precisa existir antes de qualquer coleta privilegiada. O navegador não recebe credenciais dos aplicativos.

## Origens fixas

| Produto | URL permitida | Credencial na origem |
|---|---|---|
| Barberias | `https://barberias.com.br/api/integrations/orbita/metrics` | `ORBITA_METRICS_TOKEN` |
| MeCard | `https://mecard.com.br/api/integrations/crm/metrics` | `CRM_METRICS_TOKEN` |
| Members | `https://members.ia.br/api/integrations/crm/metrics` | `CRM_METRICS_TOKEN` |

Configurar no CRM `APP_METRICS_SOURCES` como array com `product`, `url`, `token`. Cada aplicativo recebe token próprio de leitura com no mínimo 32 caracteres. Nunca usar chaves de banco, senha pessoal ou credencial de outro agente. Não colocar no vault, frontend ou documentação. HTTPS, host e caminho são fixos; sem redirects, query string, portas ou credenciais na URL. Resposta máxima 32 KiB, timeout 8 s. Configuração ausente e falhas não viram zero.

O contrato `version:1` tem `product`, `generatedAt`, `window:{from,to}` e `metrics` com oito valores inteiros não negativos ou `null`: `users`, `accounts`, `activeAccounts`, `trialAccounts`, `payingAccounts`, `complimentaryAccounts`, `canceledAccounts`, `activatedAccounts`. Projeção explícita rejeita contagens inválidas, produto diferente e datas futuras e remove campos extras. Snapshot de estoque pode ter `from=to=generatedAt`; não representa crescimento no período.

## Definições e limites

- Barberias: equipe com login; conta é a unidade da assinatura, com filiais consolidadas. Ativação segue a regra do produto. Assinatura com acesso não é recebimento conciliado.
- MeCard: nesta primeira coleta, usuários/contas seguem `admin_dashboard.metrics.users`, incluindo a administração. O relatório existente continua sendo a fonte, sem novas políticas ou migrations. Não transformar plano Pro em pagante: ele pode vir de teste ou administração. Demais medidas permanecem `null` até termos agregação canônica própria.
- Members: total de perfis registrados, incluindo administração, produtores e alunos, obtido por HEAD/count exact sem ler nomes, documentos ou e-mails. Não confundir compradores, produtores, assinantes de um produto e clientes da plataforma. Os demais campos permanecem `null`.

Publicar o endpoint desligado não comprova integração ativa. Só marcar coleta disponível depois de configurar o par de credenciais, consultar pelo CRM e comparar com o painel administrativo do aplicativo. Viajeki e AG LABS entram depois com métricas próprias e a mesma revisão do contrato.

Cadastros, ativação, checkout e pagamento precisam de eventos distintos. Pagamento só vem do ledger/gateway verificado; navegador não promove contato a Cliente. Conteúdo de e-mails, dados pessoais e eventos analíticos individuais continuam nas fontes adequadas. CRM não deve receber uma cópia indiscriminada de telemetria.
