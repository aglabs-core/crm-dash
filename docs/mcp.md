# Servidor MCP do CRM

`/api/mcp` expõe o CRM para a Órbita e para agentes autorizados, pelo protocolo MCP (Streamable HTTP, sem sessão, respostas JSON). Funciona com Claude Code, Codex e o SDK oficial.

## O que dá para fazer

| Ferramenta | Escopo | O que faz |
| --- | --- | --- |
| `crm_prioridades` | `leitura` | Agregados por `produto` opcional: tarefas vencidas, testes encerrados confirmados e oportunidades sem tarefa pendente. Sem nomes, IDs, assuntos ou mensagens. Consulta completa; erro nunca vira zero. Revisão humana em `/actions` |
| `crm_resumo` | `leitura` | Funil por etapa (sem a base fria), contas no produto (trial, trial encerrado, ativo, cancelado), novos contatos em 7 e 30 dias, receita líquida acumulada (`receita_total`), do mês e do mês anterior, tarefas pendentes, vencidas e por responsável. Com `produto` (ex.: `barberias`), tudo filtrado por ele; sem `produto`, inclui `por_produto` |
| `crm_funil_emails` | `leitura` | Totais dos e-mails registrados no período (`dias`, padrão 30): enviados, entregues, abertos, cliques, respostas, falhas e descadastros, com taxas sobre entregues, por categoria e por origem. Filtra por `produto` e `categoria`. Sem endereço, assunto ou conteúdo |
| `crm_tarefas` | `leitura` | Tarefas pendentes, das mais urgentes para as menos urgentes; filtro por responsável e por situação (`vencidas`, `hoje`, `ate_hoje`) |
| `crm_buscar_contatos` | `leitura` | Busca por nome, empresa, e-mail ou Instagram (até 10 fichas) |
| `crm_contato` | `leitura` | Etapa, produto, últimas 8 interações, tarefas pendentes e receita do contato |
| `crm_criar_tarefa` | `tarefas` | Cria tarefa com responsável (`maia`, `leo`, `antonio`, `tecnico`), prazo, prioridade e contato |
| `crm_concluir_tarefa` | `tarefas` | Conclui tarefa pendente e registra o motivo em `activities` (vale para cancelada ou substituída) |
| `crm_registrar_atividade` | `atividades` | Registra nota, follow-up, suporte ou reunião que já aconteceu |
| `crm_feedback` | `leitura` | Feedback enviado pelos apps (botão *Enviar feedback*), do mais recente ao mais antigo: produto, texto, tela de origem, status e o contato (nome, etapa, conta) quando o e-mail bate. Filtros `produto`, `status` e `limite` (até 100). Sem `status`, todos exceto arquivados. Sem e-mail ou telefone |
| `crm_atualizar_feedback` | `atividades` | Marca um feedback como `novo`, `lido`, `resolvido` ou `arquivado`, registrando o nome do token |

E-mail para um contato é enviado pelo Léo: a tarefa vai para `leo`, com o contato e o conteúdo. Atribuir não prova que ele recebeu (veja *Requisitos de integridade do CRM* no vault).

### Produto

`produto` usa a mesma chave das campanhas: minúsculas, e o código histórico `barberpro` conta como `barberias`. A receita por produto soma só pagamentos registrados com aquele produto; tarefas por produto são as ligadas a contatos do produto (tarefa sem contato fica de fora). Taxas sem base voltam `null`: ausência de dado não é zero. Agendamentos (`scheduled`) e registros com data futura ficam fora do funil de enviados, das campanhas e das taxas. Abertura depende de pixel e pode incluir abertura automática do provedor.

## O que não dá para fazer

- Excluir, exportar ou rodar SQL.
- Mudar a etapa do funil, a prospecção ou a autorização de contato (`outreach_status`).
- Ler e-mail, telefone, WhatsApp ou documento. A ficha diz só se o canal existe (`tem_email`, `tem_whatsapp`).
- Gravar número de cartão ou senha/token com o valor ("senha: ..."): o texto é recusado. Falar de senha ou token ("redefinir senha") é permitido.

Toda tarefa criada leva "Criada por <nome do token>" e toda atividade, "(registrado por <nome do token>)", para a origem ficar visível na ficha.

## Configuração

Variáveis do servidor (nunca com prefixo `NEXT_PUBLIC_`):

| Variável | Uso |
| --- | --- |
| `CRM_MCP_TOKENS` | Um token por agente: `nome:token:escopo,escopo`, separados por `;`. Token com 32+ caracteres (`openssl rand -hex 32`). Sem a variável, a rota responde 503 |
| `SUPABASE_SERVICE_ROLE_KEY` | Já usada pelos receptores de webhook |
| `CRM_OWNER_USER_ID` | Opcional. Usuário em nome de quem as tarefas e atividades são gravadas; sem ela, o único registro de `admin_users` |

O servidor lê o mesmo que o administrador vê no painel: contatos, atividades, tarefas e pagamentos de todos os donos, inclusive os registros criados pela Maia no usuário dela. As escritas saem em nome do administrador, como no painel.

Exemplo, com a Órbita lendo, criando tarefas e registrando interações:

```
CRM_MCP_TOKENS="orbita:<token>:leitura,tarefas,atividades"
```

Para revogar, tire a entrada e publique de novo.

## Conectar

```bash
claude mcp add --transport http crm https://<endereço do CRM>/api/mcp --header "Authorization: Bearer <token>"
```

Na Órbita: `CRM_MCP_URL=https://<endereço do CRM>/api/mcp` e `CRM_MCP_TOKEN=<token>` nas variáveis da Vercel.

## Código e testes

- `lib/mcp-server.ts`: protocolo, autenticação, escopos, validação e ferramentas.
- `lib/mcp-store.ts`: consultas ao Supabase.
- `lib/mcp-server.test.ts`: protocolo, escopos, validação, cálculo do resumo e escrita, com banco falso.

O feedback dos apps usa a migration `20261030010000_product_feedback.sql` (tabela `product_feedback` e RPCs `crm_ingest_product_feedback` / `crm_set_product_feedback_status`, só `service_role`). As demais ferramentas usam as tabelas que já existiam.

## Feedback dos apps

O backend de cada produto envia `POST /api/integrations/feedback` com `Authorization: Bearer <ACCOUNT_EVENTS_TOKEN>` (o mesmo token dos eventos de conta):

```json
{ "event": "feedback.submitted", "event_key": "<id do feedback no app>", "occurred_at": "2026-10-29T12:00:00Z",
  "product": "members", "account_ref": "<id da conta>", "owner_email": "pessoa@exemplo.com",
  "message": "texto de 3 a 2000 caracteres", "pathname": "/tela/de/origem" }
```

- `event_key` deduplica por produto: reenviar o mesmo feedback não duplica.
- O CRM liga ao contato pelo e-mail e grava uma nota *suporte* na linha do tempo. **Não cria contato**: sem e-mail conhecido, o feedback fica sem contato.
- Só o caminho da tela é guardado (query string é descartada).
- Respostas: `200` aceito, `400` evento inválido, `401` token errado, `503` receptor sem configuração ou banco indisponível (reenviar depois).

### Janelas de receita

`receita_total` usa o histórico de pagamentos registrados, após estornos, inclusive registros sem data de pagamento. `receita_mes` e `receita_mes_anterior` usam `paid_at` e o calendário de São Paulo; registros sem data não são atribuídos a um mês. Datas futuras ficam fora dos agregados. O cartão principal do dashboard é acumulado, portanto deve ser comparado a `receita_total`, não à receita do mês. A consulta preserva o filtro por produto e não devolve transações nem identidades.
