# Executor comum — vertical de envio único, dormente

> Registro histórico do PR67 initial-only. A continuação dependente implementa
> step2 text-only e reconciliação: [contrato atual da fatia](campaign-second-step.md).
> As limitações abaixo descrevem a entrega original, não o alcance da continuação.

## Entrega e limite de autorização

Implementação **offline**, sem import por rota/job, sem cron, sem credenciais, sem provider real e sem migration remota. A migration instala `enabled=false` e `wait_seconds=NULL`; não há RPC de ativação. O executável exige também `enabled === true`. Aprovar um lote continua sendo aprovação de conteúdo/público, não ativação do executor.

Esta fatia executa **somente `step=initial`** de um lote já aprovado pelas RPCs existentes. Não executa segunda etapa, não aceita completed como autorização e não transforma o review de follow-up em fila. É o vertical concreto de envio único + retry seguro permitido no pedido; não uma alegação de cadência pronta.

## Caminho exercitado

1. Campanha draft Brevo + template sintético → review/fingerprint → aprovação atual → destinatário congelado.
2. Provider preflight determinístico, antes de claim; conteúdo/endereço não vêm do argumento do caller.
3. `claim_campaign_dispatch(item_id)` com sessão **autenticada do dono**, flag do banco, intervalo obrigatório explicitamente configurado **após approved_at**, lote approved e preflight atual.
4. Outbox durável com unicidade `(item_id,step)`, `(owner,produto,endereço,step)` e `(owner,produto,contato,step)`. Deduplica inclusive entre lotes/campanhas. Não normaliza além da política já congelada pela aprovação. O dedupe é conservador: um initial por pessoa/endereço/produto/dono durante toda a retenção, não uma janela de marketing inventada.
5. Claim CAS token/lease de 60 segundos. Lock transacional por dono serializa admissões concorrentes; não há batch scanner. Uma chamada processa no máximo **um** item; não existe limite comercial total ou política de cadência implícita.
6. `start_campaign_dispatch(id,token)` revalida elegibilidade, ponte canônica e estado da aprovação; persiste `dispatch_started` e timestamp **antes** de entregar payload ao provider HTTP. Claim/start/finish são transações separadas.
7. HTTP JSON genérico sem retry e sem redirect; retorno estrito `messageId` não vazio, máximo 500 caracteres. A aceitação grava recibo durável, não entrega. O adapter **não é a integração Brevo de produção**.
8. Falha/timeout/resposta malformada após start → `uncertain`. Resposta perdida do banco após start ou finish não reabre claim. Dispatch expirado vira uncertain na próxima admissão; não há reaper/scheduler ativo.

## Preflight e fencing

Preflight consulta as fontes atuais do CRM: dono da campanha/lote/destinatário/contato, endereço/produto atuais, `recipient_reason` (inclui supressões), conta/trial/account_ref, pool frio/status Arquivado, pagamento líquido positivo no dono permitido ou tenant técnico, resposta inbound/replied, suppression no ledger, histórico outbound de prospecção, eventos/ID de envio do destinatário e endereço repetido na campanha. O intervalo initial mede espera após **aprovação**, não após entrega anterior; não deve ser usado como intervalo de follow-up.

Preserva a distinção entre tenant técnico Maia e dono administrativo dos contatos. Não transfere ledger nem exige igualdade universal. Não comprova fontes fora do CRM, frescor do espelho do provider ou contas não reconciliadas.

Retry automático só é seguro para claim pré-efeito expirado ou explicitamente liberado em `claimed`. Reclaim gira token; start/finish/release antigos são fenced. `dispatch_started`, accepted, uncertain e review nunca voltam a ready pelo executor. Não há API para reenviar uncertain ou converter review em autorizado.

Revogação/flag off antes de start bloqueia o envio. A transação start é o ponto de linearização: uma revogação ou resposta que chegue **depois** do start não recolhe I/O já autorizado/em voo. Não há promessa de cancelar efeito aceito nem locks de todos os escritores externos durante HTTP. Após off, recibos de efeito já iniciado ainda podem ser persistidos. Uma nova chamada off não faz claims ou HTTP.

As tabelas privadas negam acesso direto a anon/authenticated/service_role; somente as RPCs estreitas autenticadas fazem transições. O dono do banco mantém poderes administrativos; não é prova de separação do owner/bypassRLS instalado. FKs RESTRICT preservam evidência; erasure/retention requer procedimento revisado antes de implantação.

## Prova reproduzível

```sh
npm ci --include=dev --ignore-scripts
npm run test:campaign-executor
env -u NODE_ENV npm run check
npm run audit:gate
```

A prova exige Node 22, Docker e `sudo -n docker`. Usa PostgreSQL 17 pelo digest fixo registrado em `evidence/campaign-executor/last-run.json`; cria seu próprio container sem rede/portas publicadas, espera o servidor definitivo, aplica migrations reais sobre o baseline reduzido dos testes de ledger existentes, inicializa batch via aprovação real e remove container/volume anônimo ao terminar (também em falha normal). HTTP sintético escuta apenas loopback com porta efêmera. Nenhum `.env` é carregado. A fixture autenticada usa `SET ROLE` + claim de sessão no PostgreSQL; **não prova JWT/PostgREST instalado**.

`09-final-integration.log`: 24 checks, seis requests locais. Inclui oito conexões concorrentes (um claim), replay, lease pré-efeito/release e token antigo, pause após claim, flag off, dono estrangeiro/ACL, provider inválido antes do claim, trial/optout/payment/suppression/intervalo/efeito anterior antes e depois de claim, retarget canônico, resposta/histórico, dedupe entre lotes, recibo malformado, perda de resposta do start/finish e SIGKILL real do worker **após HTTP aceito** seguido de restart real do PostgreSQL. Expiração de lease é avançada por SQL sintético, não por espera de 60 segundos. Readbacks verificam estado/recibo persistido e ausência de outro request.

Gates gerais: lint/typecheck, 165 testes Node/PGlite, 53 UI e build passaram; audit:gate de produção zero avisos/zero exceções. O gate normal não inclui o teste Docker: há comando separado explícito, não prova CI integrada.

Histórico honesto: `01-red.log` prova ausência do schema (não RED completo de envio); `02-green-attempt.log` falhou porque o timeout sintético de 50ms incluía o readback Docker, corrigido para 1000ms/atraso de 1500ms. Os primeiros regressivos adicionais passaram já verdes. `05-retarget-red.log` é RED comportamental verdadeiro (`dispatch_started` em vez de review), corrigido pela comparação da identidade canônica durável. `06-green.log` falhou somente por consultar o PostgreSQL antes de ficar pronto após restart; o runner agora espera prontidão. Logs preservados, sem renomear tentativas falhas como provas positivas. `08-cleanup-failure.log` expôs que `docker rm -f` neste host não removia o volume anônimo apesar de `--rm`; o runner foi corrigido para `rm -f -v`, remoção explícita apenas dos volumes capturados do próprio container e readback de ausência. O run final confirma container e volumes próprios removidos. Runs anteriores não capturavam seus nomes: podem ter deixado volumes anônimos locais; não houve prune nem exclusão de volumes sem atribuição segura. O volume do probe de cleanup, de nome conhecido, foi removido e conferido separadamente.

## Ainda falta para segunda etapa automática / release

- PR65 corrigido até `3ba73372e35c74cbff38e977f9ff27ad3cc86653` foi integrado nesta branch por merge normal, sem alterar/mesclar o PR65 remoto. Os gates acima já incluem essa base reconciliada; publicação continua dependendo da revisão independente do pai.
- Escolha comercial final de conteúdo/versionamento, intervalo **após entrega inicial**, escopo e limite de tentativas. Nada escolhido/inventado aqui.
- Aprovação congelada específica de step2 e vínculo à entrega inicial. A aprovação atual recusa histórico; não foi afrouxada. Implementar outro step exige migration/contrato e testes próprios; CHECK atual só admite initial.
- Scanner/scheduler autenticado e bounded que selecione itens aprovados sem starvation; nenhuma rota/caller/cron real foi habilitada.
- Adapter real com sender/Reply-To/account binding e autenticação de least privilege; integração PostgREST e recibos reais autorizados em staging. O executor recebe RPC/provider por injeção; isso não instala autenticação.
- Espelho de aceitação no ledger/eventos/destinatários e reconciliação de receipt incerto/publicação sem resend. **Este vertical conserva recibos apenas na outbox privada**, não escreve o ledger de emails nem marca o destinatário como enviado. O dedupe novo lê a outbox; emissores antigos não foram integrados. Sem coordenação com outros emissores não se deve ativá-lo.
- Tratamento administrativo de review/uncertain, observabilidade e erasure/retention. Sem retry de efeito remoto, sem delivery/RFC Message-ID comprovados.
- Revisão independente do pai, gates na base reconciliada, comparação de DDL/ACL instalado, migration e autorização explícita de ativação. Nenhum merge/deploy foi feito.

Rollback antes de ativação: não publicar/importar o módulo. Depois de migration, manter flags off preserva evidências; não apagar outbox para forçar retry. Nenhum procedimento de rollback de produção foi executado.
