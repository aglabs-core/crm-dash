# Visibilidade CRM — extração independente da UI do PR #65

## Escopo e contrato

Base: `main` em `e93a58075cd3be5f28b10d5e6924d10c27fb226a`. Fonte preservada: PR #65 em `3ba73372e35c74cbff38e977f9ff27ad3cc86653`.

Esta extração copia somente Funil/Central e seus testes aprovados. Conta, último envio/status, conversa humana e tarefa são dimensões separadas. “Sem tarefa manual” inclui evidência histórica de entrega lifecycle e não autoriza nova abordagem nem presume cadência futura.

Nenhuma migration, guard, backfill, RPC de follow-up ou painel dependente foi copiado. Nenhuma escrita de contato/etapa, envio, consulta a contas reais ou credencial de produção é necessária para a validação local.

A consulta embutida **não depende das migrations novas do PR #65**:

- `supabase/migrations/20261022120000_unified_email_ledger.sql:42-78`, já em main, cria `email_messages`, todos os campos selecionados (`id,category,source_key,status,sent_at`, e `delivered_at` na Central) e `contact_id REFERENCES public.contacts(id)` na linha 45. Essa FK é a relação usada por `emails:email_messages(...)`.
- A mesma migration, linhas 112-125, habilita RLS e SELECT autenticado. Administrador pode ler o ledger do tenant técnico Maia; a UI não impõe igualdade `email_messages.user_id = contacts.user_id` e não remove a RLS.
- A conta usa `account_status` já presente em main; nenhuma coluna é adicionada aqui.
- O loader mantém filtros de tarefas/conversa, paginação de contatos e limites embutidos de uma linha por pai. Último e-mail significa último **outbound** desta consulta, não última conversa humana. A projeção não inclui corpo/endereço.
- A Central passa a consultar categorias lifecycle, mas `buildActions` continua ignorando automação/transacional na detecção de resposta aguardando retorno humano.

Isso prova compatibilidade com o contrato versionado em main. Testes de transporte sintético verificam a URL Supabase; testes PGlite executam migrations já existentes. Não é uma alegação de execução contra PostgREST remoto nem de inventário de migrations aplicadas em produção. Falhas de consulta continuam explícitas, não são traduzidas em ausência de contato/tarefa.

## Evidência reproduzida

Os cinco arquivos de testes extraídos são idênticos à referência #65; seus RED anteriores não foram apagados nem reclassificados. Nesta base main, antes de copiar a implementação:

- `env -u NODE_ENV npx tsx --test lib/action-center.test.ts lib/pipeline-data.test.ts`: exit 1, duas falhas comportamentais (sem evidência lifecycle e sem coleção de emails).
- `env -u NODE_ENV npm run test:ui -- tests/action-center.test.tsx tests/pipeline-email-context.test.tsx tests/nullable-contact-consumers.test.tsx`: exit 1, três falhas comportamentais (lifecycle e rótulos/dimensões ausentes).

Depois da extração:

- `env -u NODE_ENV npm run check`: exit 0 — lint, typecheck, 158 testes lógica/banco, 52 testes UI e build de produção.
- `npm run audit:gate`: exit 0, zero avisos de produção/exceções. Instalação completa reportou 19 moderate e 3 high no conjunto com devDependencies; não houve alteração de dependências.
- Suites Python de pagamento e conversão institucional: primeira tentativa sem privilégio bloqueada pelo socket Docker (zero testes, não falha funcional). Reexecutadas com `sudo -n python3` usando os módulos originais e alterando somente `CONTAINER` em memória para nomes exclusivos `crm-ui-only-*`, sem mudar os testes/gates ou dados reais. Ambas passaram; containers exclusivos removidos ao final.

Logs operacionais locais: `/home/ubuntu/projects/operations/ecosystem-growth-review/evidence/crm-ui-independent/` (`red-logic.log`, `red-ui.log`, `check.log`, `payment-ledger-isolated.log`, `institutional-isolated.log`). CI e preview devem ser conferidos no SHA exato do PR; build local não prova deploy autenticado.

## Reconciliação sem duplicatas

Não mergear #65 como está junto desta extração. Após review/merge desta UI pelo responsável:

1. Partir de main atualizado e extrair do SHA de referência somente os guards/migrations/backfill/testes correspondentes para PR próprio, respeitando revisão de schema e aplicação antes de consumidores dependentes.
2. Manter `CampaignFollowupReview`, alteração de campaigns, sua RPC/migration e testes em outro PR dependente, se ainda desejado. Não cherry-pickar o commit misto integral.
3. Não reaplicar os dez arquivos UI/testes desta extração. Comparar `git diff main...<branch>` para que esses arquivos desapareçam do delta residual. Resolver documentação de release de acordo com o novo escopo; o aviso de duas migrations do #65 não é requisito desta UI independente.
4. Fechar/superseder #65 apenas depois de registrar os PRs sucessores, sem perder sua evidência RED e revisão do guard. Esta tarefa não modifica #65, não fecha PR e não faz merge.

Rollback desta UI: revert do seu commit de merge; nenhum rollback SQL ou alteração de dados é necessário.
