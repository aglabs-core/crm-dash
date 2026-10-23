# Servidor MCP do CRM

`/api/mcp` expõe o CRM para a Órbita e para agentes autorizados, pelo protocolo MCP (Streamable HTTP, sem sessão, respostas JSON). Funciona com Claude Code, Codex e o SDK oficial.

## O que dá para fazer

| Ferramenta | Escopo | O que faz |
| --- | --- | --- |
| `crm_resumo` | `leitura` | Funil por etapa (sem a base fria), novos contatos em 7 e 30 dias, receita líquida do mês e do mês anterior, tarefas pendentes, vencidas e por responsável |
| `crm_tarefas` | `leitura` | Tarefas pendentes, das mais urgentes para as menos urgentes; filtro por responsável e por situação (`vencidas`, `hoje`, `ate_hoje`) |
| `crm_buscar_contatos` | `leitura` | Busca por nome, empresa, e-mail ou Instagram (até 10 fichas) |
| `crm_contato` | `leitura` | Etapa, produto, últimas 8 interações, tarefas pendentes e receita do contato |
| `crm_criar_tarefa` | `tarefas` | Cria tarefa com responsável (`maia`, `leo`, `antonio`, `tecnico`), prazo, prioridade e contato |
| `crm_concluir_tarefa` | `tarefas` | Conclui tarefa pendente e registra o motivo em `activities` (vale para cancelada ou substituída) |
| `crm_registrar_atividade` | `atividades` | Registra nota, follow-up, suporte ou reunião que já aconteceu |

E-mail para um contato é enviado pelo Léo: a tarefa vai para `leo`, com o contato e o conteúdo. Atribuir não prova que ele recebeu (veja *Requisitos de integridade do CRM* no vault).

## O que não dá para fazer

- Excluir, exportar ou rodar SQL.
- Mudar a etapa do funil, a prospecção ou a autorização de contato (`outreach_status`).
- Ler e-mail, telefone, WhatsApp ou documento. A ficha diz só se o canal existe (`tem_email`, `tem_whatsapp`).
- Gravar cartão, senha ou token: o texto é recusado.

Toda tarefa criada leva "Criada por <nome do token>" e toda atividade, "(registrado por <nome do token>)", para a origem ficar visível na ficha.

## Configuração

Variáveis do servidor (nunca com prefixo `NEXT_PUBLIC_`):

| Variável | Uso |
| --- | --- |
| `CRM_MCP_TOKENS` | Um token por agente: `nome:token:escopo,escopo`, separados por `;`. Token com 32+ caracteres (`openssl rand -hex 32`). Sem a variável, a rota responde 503 |
| `SUPABASE_SERVICE_ROLE_KEY` | Já usada pelos receptores de webhook. Ignora a RLS; por isso toda consulta e escrita fixa o dono da base |
| `CRM_OWNER_USER_ID` | Opcional. Dono da base; sem ela, usa `crm_dono_da_base()` |

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
