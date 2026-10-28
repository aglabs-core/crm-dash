# Registro único de e-mails

## Problema

Os e-mails trocados com um contato estavam espalhados e sem status final:

- prospecção pela Brevo virava nota de texto em `activities`, escrita na hora do agendamento e nunca atualizada (bounces, aberturas e cliques ficavam só no painel da Brevo);
- os eventos do webhook Brevo só casavam com destinatários de campanha;
- os e-mails do sistema Barberias (Resend: boas-vindas, etapas do teste, recuperação com cupom) nunca chegavam ao CRM. As barbearias em teste nem eram contatos;
- quando alguém respondia em `suporte@barberias.com.br`, a Maia não sabia o que tinha sido enviado. Se o contato já existia no CRM (prospect criado pelo Léo), a entrada dela caía em identidade pendente.

## Modelo

Migration `20261022120000_unified_email_ledger.sql`.

- `email_messages`: uma linha por mensagem, enviada ou recebida. Guarda contato, direção, provedor (`brevo`, `resend`, `mailbox`), categoria (`prospeccao`, `campanha`, `automacao`, `transacional`, `atendimento`), origem (`source_key`, ex. `barberias.trial.recuperacao`, `prospeccao.barberias.2026-10-16-lote-2`), assunto, resumo, prévia (`body_html`/`body_text`, quando nós temos o conteúdo), ID do provedor, **Message-ID RFC** e status.
- `email_message_events`: histórico de eventos por mensagem, deduplicado por chave.
- O status só avança (`aceito → entregue → aberto → clicou → respondeu`). Falha permanente, spam e descadastro sobrepõem o engajamento e marcam o contato como **não contatar**. Abertura por proxy não muda o status.
- `contacts.account_status` (`trial`, `trial_encerrado`, `ativo`, `cancelado`) é o estado da conta no produto, **separado do funil**. Um e-mail de etapa antiga nunca regride a conta, e um cliente nunca volta para Lead.
- Nova origem `cadastro`: conta criada no produto.

O Message-ID da Brevo é o próprio cabeçalho `Message-ID` (conferido num e-mail entregue). O Resend devolve `message_id` na API. Assim, a resposta do cliente é casada pelo `In-Reply-To`/`References`.

## Entradas (todas server-side, `service_role`)

| Entrada | O que faz |
|---|---|
| `POST /api/integrations/brevo/webhook` (existente) | Cada evento do inbox também atualiza o registro, via trigger. Eventos anonimizados (abertura/clique sem endereço, `an#…`) deixam de derrubar o lote com 400 e são atribuídos pelo assunto personalizado exato. |
| `POST /api/integrations/resend/webhook` | Assinatura Svix (`RESEND_WEBHOOK_SECRET`). E-mails do Barberias ao dono da conta viram contato + mensagem. E-mails para clientes finais ou equipe de uma barbearia (agendamento, senha, convite de equipe) são descartados sem guardar nada. |
| `POST /api/integrations/accounts/events` | Ciclo de vida enviado pelo produto (Bearer `ACCOUNT_EVENTS_TOKEN`): `account.created`, `trial.started`, `onboarding.completed`, `first_appointment`, `trial.ended`, `subscription.active`, `subscription.canceled`, `account.access_granted`, `account.access_revoked`. |
| RPC `crm_record_outbound_email(p)` | Agentes (Léo) e backfill registram um envio. Idempotente por provedor + ID. |
| RPC `crm_apply_email_event(...)` | Evento avulso de provedor. |

Ao registrar um envio para o e-mail principal de um contato, o CRM vincula esse endereço ao contato na identidade de e-mail da Maia (`maia_intake_private.identities`). Nunca toma um vínculo existente nem vincula endereço compartilhado por dois contatos. O pool pertence ao usuário administrador do painel, diferente do usuário da Maia: o vínculo admite esses contatos sem transferir o proprietário. O ingresso legado só os reutiliza depois do registro de um envio para o endereço canônico. Outros usuários continuam fora do escopo. Com isso, a resposta de um prospect entra direto na ficha certa.

## Maia

O contrato restrito para o gateway está na migration `20261022184326_maia_email_ledger_bridge_v1.sql`. Ele exige a identidade de e-mail admitida no intake e vincula remetente, caixa, thread e evento; a Maia não recebe credencial de banco nem chama essas funções diretamente.

- `maia_email_ledger_context_v1(p_sender, p_mailbox, p_thread_id, p_event_id, p_reference_ids)`: consulta somente a mensagem de saída vinculada ao contato canônico e a uma referência RFC informada. Retorna metadados e resumo da mensagem ou `unknown`; não retorna o corpo nem escolhe uma mensagem recente por endereço. O restante do histórico autorizado é um contrato separado.
- `maia_email_ledger_reply_v1(...)`: exige também interação de e-mail já registrada com sucesso para o mesmo evento, resumo e contato. Vincula a resposta apenas à mensagem referenciada e guarda um recibo idempotente por evento e Message-ID; se não houver correspondência, registra `unmatched`, sem marcar uma campanha por suposição. Reenvio idêntico é seguro; alteração do conteúdo para o mesmo evento é conflito.
- As funções `maia_email_context` e `maia_email_reply_record` pertencem ao contrato anterior do ledger. A segunda permite correspondência pelo último envio em 30 dias e é chamada internamente pela ponte somente após selecionar a referência canônica; não usá-las diretamente para contornar o escopo da sessão da Maia.
- `maia_email_record`/`maia_email_history` seguem como contratos distintos. As RPCs `maia_trial_outbound_*` da continuidade de trial são independentes. Configuração, migration presente ou workflow ativo não comprovam que o gateway executou a ponte para uma mensagem real.

## Interface

- Ficha do contato: seção **E-mails**, paginada em 25 mensagens (assunto, resumo, status, origem). Ao abrir, busca o corpo armazenado e os eventos em paralelo. Para Resend sem corpo, consulta `GET /api/emails/[id]/content` somente ao abrir a mensagem. Ao lado do nome aparece o selo do estado da conta.
- A rota de conteúdo valida o JWT e consulta a mensagem com RLS usando a chave pública e o token do usuário. Só depois usa `RESEND_API_KEY` no servidor para recuperar o corpo exato. Confere ID, assunto e destinatário único; não aceita um ID do provedor arbitrário enviado pelo navegador, não usa service_role e não grava o corpo recuperado. Respostas usam `private, no-store` e `Vary: Authorization`. Sem chave ou fora da retenção, continua mostrando resumo e eventos. Falha temporária permite tentar novamente.
- A prévia usa `iframe` com `sandbox` sem permissões e CSP sem scripts, formulários ou conexões. Imagens externas são bloqueadas até clicar em **Carregar imagens externas**, pois pixels podem gerar uma abertura no provedor. Nunca apresentar a consulta como leitura do cliente. Documentação: https://resend.com/docs/api-reference/emails/retrieve-email.
- Índice: **E-mails por produto**, com Barberias e AG LABS institucional como opções iniciais. Produtos já presentes no registro/campanhas aparecem automaticamente, sem criar entradas de produtos futuros. Não atribuímos registros sem produto por heurística: ficam em **Produto a definir**. `localsite` mantém seu contexto de Desenvolvimento web.
- Dentro do produto: **Sistema · testes e recuperação** (`automacao`, `transacional`), **Prospecção** (`prospeccao`) e **Campanhas** (`campanha`). Lotes e campanhas são consultados no banco por produto, com até 15 por página. A view `email_source_summary` continua sendo a fonte das métricas; `email_workspace_products` fornece somente as chaves de produto acessíveis pela RLS. Abrir Sistema ou Prospecção não carrega os rascunhos e seus corpos.
- Métricas representam todo o histórico registrado, por mensagem. Entrega é entregues / mensagens registradas; abertura/clique são sinais auxiliares. A paginação não muda o denominador de cada lote.

## Ativação

1. Aplicar a migration (dry-run antes). Ela é aditiva: tabelas, colunas e funções novas, mais um trigger no inbox Brevo.
2. Publicar o front. Antes da migration, as telas novas ficam ocultas ou mostram "indisponível".
3. Backfill (não envia nada): `NODE_USE_ENV_PROXY=1 tsx scripts/backfill-email-ledger.ts resend --apply` e `... brevo <manifest.json> --apply`. O manifesto da prospecção é montado fora do repositório, porque contém dados de leads.
4. Resend: criar o webhook para `https://crm.aglabs.api.br/api/integrations/resend/webhook` com os eventos `email.*`, e configurar `RESEND_WEBHOOK_SECRET` no servidor. `RESEND_API_KEY` é opcional: permite gravar o Message-ID já no evento `email.sent`.
5. Produto: configurar `ACCOUNT_EVENTS_TOKEN` (≥ 32 caracteres) no CRM e no Barberias.
6. Maia (n8n VPS-03): conferir que a migration da ponte restrita foi aplicada e que o gateway usa o evento admitido e os endpoints de contexto/resposta correspondentes. A consulta de contexto ocorre antes de responder; o registro da resposta exige interação registrada. Verificar associação e recibo no ambiente apropriado, sem enviar mensagens a clientes como teste.

Para a organização por produto e a carteira paginada, aplicar também `20261022195737_crm_workspace_indexes.sql` antes de publicar o front correspondente. A migration é aditiva e idempotente, não altera estágios nem dispara automações. As views usam `security_invoker` e não têm acesso anônimo. Validar os planos das consultas com o volume real antes de adicionar mais índices.

## Validação

`lib/email-ledger-db.test.ts` (PGlite) cobre:

- registro idempotente e vínculo de identidade;
- espelho do webhook com status que só avança;
- clique anonimizado;
- contexto da Maia por thread;
- resposta marcando campanha;
- bounce bloqueando o contato;
- trial virando Lead sem regredir conta ativa;
- RLS.

`lib/email-integrations.test.ts` cobre:

- classificador;
- assinatura Svix;
- normalização do Resend;
- eventos de conta;
- receptor Brevo com eventos anonimizados.

## Reconciliação do acesso do produto

`account.access_granted`/`account.access_revoked` registram cortesia ou acesso vitalício sem promover a etapa para Cliente. `subscription.active` continua reservado ao evento real de pagamento. O selo genérico é “Conta ativa”: o detalhamento e a natureza do acesso ficam na timeline. A reconciliação lê o estado atual no Barberias e publica cada snapshot com chave idempotente; nunca chama jobs de e-mail.
