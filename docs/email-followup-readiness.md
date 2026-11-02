# E-mails, etapas e segunda abordagem — revisão de código

## Conclusões

- `account_status`, estágio comercial e histórico de mensagens são dimensões distintas. Um trial pode continuar Lead depois de receber a sequência completa. Contatado=0 não significa ausência de entrega. Não há correção de estágio/dados históricos neste PR.
- O CRM atual **não tem executor de envio/cadência**. A aprovação congela conteúdo e público; `campaign_batch_overview` não faz claim. Campanha completed significa histórico conciliado, não segunda etapa programada. Templates visuais existentes não são conteúdo/intervalo aprovado de uma cadência.
- A sequência trial/recuperação pertence ao produto. Este PR não modifica Barberias, não cria sequência concorrente e não chama seus jobs.

## Proprietários: não corrigir o contrato por igualdade simplista

`20261022120000_unified_email_ledger.sql` define um tenant técnico fixo para mensagens/identidades Maia. `contact_owner` admite esse tenant ou administrador; `resolve_contact` preserva o proprietário do contato. `record_outbound` grava `email_messages.user_id=tenant` inclusive quando contato e campanha pertencem ao administrador. `intake_contact` exige esse outbound para reutilizar o contato administrativo; as RPCs de contexto/resposta e o espelho Brevo filtram explicitamente o tenant técnico.

Portanto contact.user_id != message.user_id **é esperado nesse vínculo**, não prova vazamento. A RLS de mensagens já permite administrador; usuários alheios continuam sem acesso. Não remover filtros, adicionar uma FK composta de igualdade ou transferir as 23 mensagens: isso quebraria a continuidade. O teste sintético cobre admin vendo o ledger, terceiro sem acesso, intake e reply com o proprietário preservado.

Lacuna real: o registro aceitava campanha/destinatário sem conferir vínculo composto com contato/endereço/produto, inclusive enriquecimento de replay. O backfill buscava campanha por nome sem dono e contato por endereço/mais antigo sem dono. A migration nova valida **a ponte permitida**, não igualdade de todos os owners. O backfill agora faz preflight de todo manifesto no dono da conexão antes da primeira escrita; ambiguidades e IDs estrangeiros falham fechados, inclusive dry-run.

`scripts/audit-email-ledger-bindings.sql` fornece diagnóstico agregado somente leitura, sem endereço/corpo. Não é corretor de dados. A descoberta viva fica a cargo da revisão operacional; não foi executada por este PR.

## Interface

- Funil mostra estado da conta e último envio com origem/status, separadamente da conversa humana e tarefa. Consulta embutida tem uma mensagem por contato, RLS preservada e sem corpo/endereço.
- Central: “Sem tarefa manual”, não “Sem próximo passo”. Inclui evidência de trial entregue e recomenda conferir histórico antes de outra abordagem. Não oculta a falta de tarefa nem presume agendamento futuro por entrega passada.
- Na campanha Brevo com histórico há revisão **somente leitura** de impedimentos da segunda etapa. Sem botão enviar/ativar. Falha/migration ausente aparece como indisponível, não público vazio.

## Preparação da segunda etapa (não é executor)

`review_email_campaign_followup(campaign_id, wait_hours)` usa a sessão autenticada do dono da campanha, reutiliza destinatários/ledger e devolve apenas IDs e razões, sem corpo/endereço. Na UI o intervalo é NULL: nenhuma duração comercial foi inventada.

Impede apresentação como candidato livre quando: vínculo mudou, sem revisão/bloqueado, conta já criada (inclusive trial encerrado/cortesia), fora do pool frio, pagamento líquido positivo, envio inicial sem entrega comprovada, intervalo indefinido/não cumprido, falha/adiamento registrado, resposta inbound ou replied, descadastro/spam/hard bounce, supressão Brevo, endereço repetido ou abordagem posterior registrada. Falhas temporárias exigem revisão, não retry automático. A checagem é conservadora sobre histórico conhecido; fontes fora do CRM não são comprovadas.

Sempre retorna `mode=preparation_only, executor_available=false`, mesmo com razões vazias. Não concede autorização, reserva ou versão de mensagem. Não integra novo provedor/serviço nem altera as aprovações existentes.

## Pendências exatas para envio real

Não se limita a decidir texto/intervalo: ainda falta executor durável comum integrado à aprovação existente, com claim/fencing por etapa, tentativa durável antes do HTTP, recibo/reconciliação de resultado incerto sem resend, dedupe de pessoa/endereço/etapa, revalidação imediata de respostas/pagamentos/supressões e limites de envio. A API do provedor não foi chamada para enviar.

Decisão comercial mínima: selecionar a versão/conteúdo final da segunda abordagem nos templates existentes, intervalo após entrega inicial e escopo/limite de tentativas. Depois: congelar nova aprovação, teste isolado com identidade reservada e autorização de ativação separada. Não reprospectar usuários trial nem reaproveitar completed como autorização.

## Validação local

`env -u NODE_ENV npm run check`: lint, typecheck, 162 testes de lógica/banco e 53 testes UI, build sem segredos passaram. `npm run audit:gate`: zero avisos de produção, zero exceções. A instalação completa apontou 19 moderate e 3 high no conjunto com devDependencies; isso não contradiz o gate de produção nem foi corrigido ampliando escopo de dependências.

RED observado antes das implementações: cartão sem estado/envio, loader sem e-mails, central sem evidência lifecycle, backfill gravando antes de detectar contato estrangeiro, vínculo campanha estrangeira aceito e revisão follow-up sem contrato/gates. Erros intermediários: import de componente inexistente (não contado como RED comportamental), coluna de supressão incorreta (corrigida conforme schema connection_id), teste legado de texto UI (atualizado ao novo rótulo). Casos adicionais de visibilidade, replay e supressão são regressões suplementares.

Provas somente sintéticas: PGlite com migrations reais e papéis autenticados, consultas Supabase com transporte HTTP substituído, UI montada. Não equivalem a migração remota, entrega ou execução instalada.

## Implantação / rollback

PR somente, sem merge/deploy/migration remota. Antes de publicar: revisão independente das duas migrations, comparar funções remotas, executar auditoria agregada e verificar RLS com sessão administrativa real. Aplicar migrations antes do frontend. Testes PGlite e HTTP sintético não provam PostgREST/deploy.

Rollback do frontend: revisão anterior. Reverter RPC nova/trigger só após revisão de efeitos concorrentes; não remover ledger, campanhas, eventos ou identidade. A migration não reescreve linhas históricas e ignora updates sem mudança do vínculo para não bloquear recebimento de eventos antigos.
