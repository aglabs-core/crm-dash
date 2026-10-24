# Servidor MCP do CRM

`/api/mcp` expõe o CRM para a Órbita e para agentes autorizados, pelo protocolo MCP (Streamable HTTP, sem sessão, respostas JSON). Funciona com Claude Code, Codex e o SDK oficial.

## O que dá para fazer

| Ferramenta | Escopo | O que faz |
| --- | --- | --- |
| `crm_resumo` | `leitura` | Funil por etapa (sem a base fria), contas no produto (trial, trial encerrado, ativo, cancelado), novos contatos em 7 e 30 dias, receita líquida do mês e do mês anterior, tarefas pendentes, vencidas e por responsável. Com `produto` (ex.: `barberias`), tudo filtrado por ele; sem `produto`, inclui `por_produto` |
| `crm_funil_emails` | `leitura` | Totais dos e-mails registrados no período (`dias`, padrão 30): enviados, entregues, abertos, cliques, respostas, falhas e descadastros, com taxas sobre entregues, por categoria e por origem. Filtra por `produto` e `categoria`. Sem endereço, assunto ou conteúdo |
| `crm_tarefas` | `leitura` | Tarefas pendentes, das mais urgentes para as menos urgentes; filtro por responsável e por situação (`vencidas`, `hoje`, `ate_hoje`) |
| `crm_buscar_contatos` | `leitura` | Busca por nome, empresa, e-mail ou Instagram (até 10 fichas) |
| `crm_contato` | `leitura` | Etapa, produto, últimas 8 interações, tarefas pendentes e receita do contato |
| `crm_criar_tarefa` | `tarefas` | Cria tarefa com responsável (`maia`, `leo`, `antonio`, `tecnico`), prazo, prioridade e contato |
| `crm_concluir_tarefa` | `tarefas` | Conclui tarefa pendente e registra o motivo em `activities` (vale para cancelada ou substituída) |
| `crm_registrar_atividade` | `atividades` | Registra nota, follow-up, suporte ou reunião que já aconteceu |

E-mail para um contato é enviado pelo Léo: a tarefa vai para `leo`, com o contato e o conteúdo. Atribuir não prova que ele recebeu (veja *Requisitos de integridade do CRM* no vault).

### Produto

`produto` usa a mesma chave das campanhas: minúsculas, e o código histórico `barberpro` conta como `barberias`. A receita por produto soma só pagamentos registrados com aquele produto; tarefas por produto são as ligadas a contatos do produto (tarefa sem contato fica de fora). Taxas sem base voltam `null`: ausência de dado não é zero. Abertura depende de pixel e pode incluir abertura automática do provedor.

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

Não há migration: o servidor usa as tabelas e as regras que já existem.
