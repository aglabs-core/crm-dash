# Segunda etapa CRM — vertical dormente text-only

Continuação dependente de PR67 (`f6c935041da3c81f0e239073bd19853c72fcbf25`). Não altera branches originais 65/67, não aplica DDL remoto, não instala cron e não envia email real.

## Decisão comercial preservada, não ativação

`campaign-second-policy.json` preserva a decisão explícita de Antonio: **uma** segunda mensagem após **7 dias desde delivered_at inicial**, sem novas tentativas comerciais. O texto é base aprovada **para revisão do lote**, não autorização para reenviar o público antigo. Ainda não há seleção de destinatários aprovada nem assunto escolhido. Maia continua responsável pelas respostas. `enabled=false`; o arquivo não é carregado automaticamente pelo runner.

A implementação aceita wait/content/subject explícitos na aprovação; não inventa defaults comerciais. O teste usa `604800` segundos e comprova recusa quando sent_at tem sete dias mas delivered_at tem apenas seis. Testes usam texto/assunto sintéticos, não confundem prévia com aprovação real. Os templates visuais existentes **não são** mensagens de follow-up aprovadas. Esta fatia envia **somente texto**: não renderiza HTML, não usa base HTML nem CTA implícito. HTML futuro exige freeze da base/versão e do resultado personalizado na mesma aprovação.

## Caminho funcional

1. Reutiliza lote e itens das tabelas de aprovação existentes. `approve_campaign_second_step(batch,subject,message,wait_seconds,key,note)` requer sessão autenticada do dono e todos os valores explícitos. Revalida destinatário atual e elegibilidade, escolhe a mensagem inicial comprovadamente entregue no ledger Maia pelo vínculo exato contato/campanha/recipient/endereço/produto e congela parent + conteúdo personalizado e aprovação `step=second`. Conteúdo final igual ao initial é recusado, mesmo quando a igualdade aparece só após renderizar `{{nome}}`.
2. Uma segunda aprovação diferente não sobrescreve a anterior. Triggers impedem mudar conteúdo/parent e aprovação já congelados. Usuários não têm escrita direta nessas colunas; tabelas privadas continuam sem grants para authenticated/service_role.
3. `claim_campaign_second_dispatch(item)` usa o mesmo control **off por padrão**, lock por dono, outbox e dedupe por item, pessoa e endereço/produto/step. Initial não é reaproveitado como envio: é evidência de parent apenas. O step é gravado explicitamente `second`.
4. `start_campaign_dispatch(id,token)` mantém o caminho initial anterior e trata second com preflight próprio. Revalida resposta por pessoa/endereço, pagamentos, supressão/optout, bounced/soft_bounced/failed/deferred, conta/trial/account_ref, pool frio, binding, aprovação e intervalo desde delivered_at. Tokens NULL, antigos e dono estrangeiro não iniciam efeito. Nenhum stage é alterado.
5. Só depois de `dispatch_started` durável o provider recebe o snapshot congelado. A aceitação grava receipt na outbox. Timeout/erro após início não permite resend. Retry pré-efeito é apenas tentativa de processamento com token novo, não nova tentativa comercial.
6. `publish_campaign_second_dispatch(id)` publica aceitação pelo contrato atual `crm_record_outbound_email`, com ponte Maia técnica/admin intacta e sem grants amplos novos. Confere readback exato de vínculo, conteúdo, timestamps e origem; conflitos de provider ID não viram sucesso por mera igualdade de endereço. Liga `in_reply_to_message_id` ao initial e guarda ledger_message_id. Não afirma entrega.
7. Erro de publicação retorna `accepted` + `ledger=pending`, nunca ready/resend. Publicação pode ser reconciliada independentemente de provider, mesmo com envio desabilitado. Timeout após commit é idempotente. A reconciliação não chama start/finish/provider e não muda stage.

## Runner compatível com job externo existente, sem instalá-lo

`runSecondBatch` → `list_campaign_second_work(mode,limit)` → admission/start/send/finish/publication. Limite de trabalho explícito 1..200; filtro de elegibilidade antes de LIMIT; itens aceitos não são reenviados. Modo reconcile seleciona apenas accepted sem marcador local. Cada item continua sujeito ao claim/start atômico, mesmo que o scanner tenha visto elegibilidade antes.

Entrada one-shot: `npm run campaign:second`. Sem `CRM_CAMPAIGN_SECOND_ENABLED=true`, sai `{"status":"disabled"}` **antes de ler configuração ou fazer rede**. Não lê dotenv nem instala timer/serviço/cron. Pode ser chamado pelo mecanismo externo já existente, sem criar nova infraestrutura. Não há cron interno neste repositório a conectar; registro na instalação de produção permanece deliberadamente ausente.

Configuração explícita do runner: `CRM_CAMPAIGN_RPC_URL` (base REST RPC), `CRM_CAMPAIGN_OWNER_TOKEN` (sessão do dono, não service-role), `CRM_CAMPAIGN_ANON_KEY` e `CRM_CAMPAIGN_BATCH_LIMIT`. Envio precisa também `CRM_CAMPAIGN_TEST_PROVIDER_URL`: **somente HTTP loopback** nesta fatia. O adapter JSON genérico não é Brevo instalado. `--reconcile` permite só bookkeeping mesmo sem flag de envio/provider; continua autenticado e limitado. Não há credenciais reais no projeto/evidências.

## Provas reais e sua fronteira

`npm run test:campaign-executor`: quatro checks de roteamento/orquestração/flag off + **45 checks PostgreSQL 17.11** (27 regressões originais + 18 novos), **11 requests de provider HTTP loopback**, além de HTTP RPC sintético autenticado exercitado pelo CLI em processo filho. A migration step2 é instalada **antes das 27 regressões**, portanto o wrapper initial também é reprovado/testado na versão final. Container sem rede externa/portas publicadas; volumes próprios removidos e ausência conferida.

Evidência principal: `evidence/campaign-step2/19-final-pg17-http.log`. REDs preservados: `01-red-pg.log` (history em vez de accepted), `03-red-ledger.log` (conteúdo não publicado), `07-red-runner-behavior.log`, `08-red-admission.log`, `13-red-personalized-repeat.log` (template repetia initial após personalização), `14-red-failure.log` (failed indevidamente admitido). `05-red-runner.log` é tentativa intermediária de teste, não o RED comportamental usado. Checks de segurança adicionais que passaram na primeira execução são regressões suplementares, não RED inventado.

Inclui perda de resposta de publicação antes/depois de commit, readback único no ledger e reconciliação sem provider; falha/trial/optout/payment/response/wait/address antes e depois de claim; imutabilidade; ACLs; CLI com header sintético verificado separadamente; SIGKILL e restart de PostgreSQL na regressão initial original. **Não** afirma SIGKILL específico do novo second nem JWT/PostgREST/n8n de produção validado. Espelho de conta/pagamentos e supressão são tão atuais quanto as fontes do CRM. A transação start é o ponto de autorização: eventos recebidos depois dela não recolhem I/O já em voo.

## Limites reais / próximos gates

- Vertical requer **lote existente** com recipients congelados correspondentes ao histórico. Campanhas históricas sem lote ainda precisam materialização/revisão supervisionada no modelo atual; a aprovação initial legada continua recusando histórico e não foi afrouxada. Esta fatia não cria/autoriza automaticamente um lote para a base antiga, não oferece UI nova de revisão e não é campanha de produção pronta.
- Política salva aprova base e sete dias, não escolhe assunto, recipients nem ativa execução. Uma aprovação second é imutável: mudar conteúdo exige procedimento revisado de nova versão, ainda não exposto por esta fatia.
- Falta adapter Brevo real com binding From/Reply-To/account, sessão do executor provisionada no mecanismo existente, instalação de migrations/ACL comparada ao DDL real, coordenação com emissores legados, revisão independente e staging autenticado. Nenhuma ampliação de credencial foi feita.
- O token GitHub atual não tem escopo `workflow`: o primeiro push foi recusado por tentar acrescentar o teste Docker ao workflow. A alteração de workflow foi retirada, sem ampliar credenciais. CI normal continua existente; o teste PG17/HTTP permanece comando local explícito e **não** deve ser descrito como executado pelo CI remoto.
- Não há retry de efeito uncertain, terceira mensagem, HTML, atualização de stage, entrega/RFC comprovados ou tratamento administrativo/erasure operacional instalado. Constraints RESTRICT preservam evidência e exigem política de retenção revisada antes de release.
- Rollback dormente: manter flags off e não instalar o job; não apagar outbox/ledger para forçar retry. Nenhum rollback remoto foi executado.
