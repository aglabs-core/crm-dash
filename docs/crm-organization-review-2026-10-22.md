# Revisão de organização — 22/10/2026

## Escopo entregue localmente

- Sincronização por fast-forward de `da20f4e` para `ee2d193` (`origin/main` na consulta).
- Índice de e-mails por produto e finalidade: sistema/testes/recuperação, prospecção e campanhas. Até 15 lotes ou campanhas por página, sem corpo das campanhas na listagem. Produtos adicionais aparecem conforme registros reais; sem classificação por heurística.
- Carteira com 50 contatos por página, busca e filtros no banco, totais por agregados separados e seleção em massa limitada à página visível. Busca por telefone/WhatsApp sem formatação preservada.
- Funil exclui pool frio na consulta; clientes consulta Cliente/Inativo; seletor de tarefas consulta somente id/nome/status; preparação da campanha consulta somente os contatos do produto correspondente.
- E-mails da ficha paginados em 25; consulta do corpo somente ao abrir. API autenticada recupera conteúdo Resend quando não estiver armazenado. RLS autoriza antes da consulta ao provedor, sem chave privilegiada na rota e sem cache público. Verificação de ID, assunto e destinatário único.
- Prévia isolada, com scripts/formulários e pixels externos bloqueados por padrão. Imagens externas exigem ação explícita.
- Orientações das etapas no funil e documentação operacional atualizadas.

## Evidência de produção somente leitura

Fonte: conexão Supabase configurada em `.env.local`, projeto `udcsokdtdqqdnoqozbxh`, consulta agregada em 22/10/2026. Nenhum registro de contato, corpo de e-mail ou payload financeiro foi exportado.

- 150 contatos; 92 no pool frio; 19 nas etapas comerciais ativas fora do pool.
- 55 mensagens registradas; 35 Resend; nenhuma dessas 35 com corpo HTML/texto armazenado.
- Migrations `20261022120000`, `20261022130000` e `20261022184326` já aplicadas.
- RLS ativa em contacts, email_messages, email_campaigns, tasks e activities.
- Estatísticas estimavam 150 contatos, 50 tarefas, 430 atividades, 4 campanhas e 55 mensagens. Esse volume não comprova gargalo de capacidade do banco.
- Consulta de estatísticas de duração SQL indisponível; nenhuma conclusão de latência baseada em `pg_stat_statements`.

Fonte n8n VPS-03: definições publicadas consultadas, sem executar workflows ou acessar execuções de clientes.

- Ingestão de pagamentos ativa; draft igual à versão publicada; consultas de verificação nos provedores antes da RPC de ingestão.
- Registro da Maia ativo; avanço comercial exige intenção, produto e motivo de qualificação; tarefa exige responsável e data.
- Registro de e-mail v2 ativo com validação de resumo e confirmação de persistência.
- Isso valida a configuração observada, não comprova uma nova cobrança, entrega em caixa de entrada ou fluxo completo de ponta a ponta.

## Validação local

- `npm run check`: lint, TypeScript, 99 testes de lógica/banco, 37 testes de interface e build aprovados na execução completa.
- Após os ajustes finais de normalização de produto e transação da migration: testes direcionados da carteira/RLS e TypeScript reexecutados.
- `npm run audit:gate`: zero avisos, zero exceções.
- `git diff --check`: sem erro de whitespace.
- A tentativa adicional de build sem variáveis encontrou restrição de rede `EACCES`; não equivale à validação sem ambiente do CI.
- Não realizada inspeção visual autenticada em navegador nem teste real de conteúdo Resend com a chave do servidor.

## Ordem de publicação pendente

1. Revisar e simular `20261022195737_crm_workspace_indexes.sql`; aplicar antes do front que depende das novas views. A migration não modifica contatos, estágios, dados de pagamentos ou automações.
2. Confirmar `RESEND_API_KEY` no servidor com permissão de leitura de mensagens; chave não entra no navegador. Retenção do provedor pode impedir prévias antigas.
3. Publicar front/API após os gates e validar autenticado em desktop/mobile: produtos, troca de filas, paginação, busca, totais e abertura de e-mail.
4. Medir tempos de navegação e de API no ambiente real. Dashboard/relatórios ainda carregam o conjunto necessário a seus indicadores; evolução para agregados deve preservar seus denominadores.

## Publicação autorizada

Após autorização de merge em 22/10/2026, PR #39 aberta. O preview da Vercel concluiu o build do commit inicial `b463380`.

A simulação identificou `20261021061151_trial_outbound_context_20261021200000.sql` aplicada no banco, mas ausente do checkout. O SQL foi recuperado do histórico remoto e conferido por fingerprint MD5 `ba20d51e3981c81b300eb6902a95d72c`; não foi reaplicado e não houve reparo do histórico. O arquivo contém somente a definição da ponte de contexto de trial, sem dados ou credenciais de publicação.

Nova simulação confirmou somente `20261022195737_crm_workspace_indexes.sql` pendente. Essa migration foi aplicada com `supabase db push --skip-vault` antes do merge, para que o deploy automático encontre as views necessárias. Nenhum disparo, cobrança ou alteração de workflow foi realizado. O merge e o deploy de produção devem ser confirmados separadamente pelos checks e pelo commit publicado.
