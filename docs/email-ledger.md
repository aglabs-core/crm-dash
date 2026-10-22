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

- `maia_email_context(p_sender, p_reference_ids)`: chamar **antes de responder**, com o remetente e os IDs de `In-Reply-To`/`References`. Devolve `match` (`thread` ou `address`), o e-mail respondido (`replying_to`: origem, assunto, resumo, data, status), a ficha (nome, produto, etapa, estado da conta, prospecção, não contatar), os últimos e-mails e a próxima tarefa. Não devolve corpo, IDs ou dados de outros contatos.
- `maia_email_reply_record(p_sender, p_reference_ids, p_rfc_message_id, p_subject, p_summary, p_received_at)`: registra a resposta recebida e marca `respondeu` na mensagem original e na campanha. O resumo passa pelo mesmo filtro de dados sensíveis.
- `maia_email_record`/`maia_email_history` continuam iguais. As RPCs `maia_trial_outbound_*` da continuidade de trial (Barberias PR #122) seguem independentes. Quando aquele fluxo for ativado, ele pode ler o mesmo registro.

## Interface

- Ficha do contato: seção **E-mails** (assunto, resumo, status, origem). Ao abrir, mostra a prévia em `iframe` com `sandbox` sem permissões e a lista de eventos. Ao lado do nome aparece o selo do estado da conta.
- Campanhas: quadro **Automações e envios registrados**, com cada etapa do teste Barberias e cada lote de prospecção (enviados, entregues, abertos, cliques, respostas, falhas). Vem da view `email_source_summary` (`security_invoker`).

## Ativação

1. Aplicar a migration (dry-run antes). Ela é aditiva: tabelas, colunas e funções novas, mais um trigger no inbox Brevo.
2. Publicar o front. Antes da migration, as telas novas ficam ocultas ou mostram "indisponível".
3. Backfill (não envia nada): `NODE_USE_ENV_PROXY=1 tsx scripts/backfill-email-ledger.ts resend --apply` e `... brevo <manifest.json> --apply`. O manifesto da prospecção é montado fora do repositório, porque contém dados de leads.
4. Resend: criar o webhook para `https://crm.aglabs.api.br/api/integrations/resend/webhook` com os eventos `email.*`, e configurar `RESEND_WEBHOOK_SECRET` no servidor. `RESEND_API_KEY` é opcional: permite gravar o Message-ID já no evento `email.sent`.
5. Produto: configurar `ACCOUNT_EVENTS_TOKEN` (≥ 32 caracteres) no CRM e no Barberias.
6. Maia (n8n VPS-03): chamar `maia_email_context` antes de responder e `maia_email_reply_record` depois de registrar a conversa.

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
