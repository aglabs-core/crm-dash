# crm-dash — CRM interno da AG LABS

Dashboard interno de contatos, funil, tarefas e relatórios. **Uso interno, sem página pública e sem SEO.**

⚠️ **Contém dados pessoais de leads e clientes reais.** Não exportar, não colar em issue, não subir dump para lugar nenhum, não registrar payload em log.

## Stack

Next.js 15 (App Router) + React 19 + TypeScript · Supabase (auth, Postgres, realtime, storage) · Tailwind v4 · Recharts.

## Antes de abrir PR

```bash
npm run check
```

Roda `lint → typecheck → build`. É o mesmo comando do CI (`.github/workflows/quality.yml`), que executa também `npm run audit:gate`.

O build **precisa passar sem variáveis de ambiente** — `lib/supabase.ts` cai num placeholder de propósito, e é assim que o CI roda. Se uma mudança quebrar isso, o problema é a mudança.

Localmente o app lê `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` de `.env.local` (veja `.env.example`). Prefixo `NEXT_PUBLIC_`, não `VITE_`.

## O modelo: `contacts` é a unidade do funil

Não existe mais tabela `deals` — foi eliminada na migration `unify_pipeline_on_contacts`, porque o funil vivia em dois lugares (`contacts.status` e `deals.stage`) e os dois divergiam. Hoje o contato carrega **a posição no funil e a economia do negócio** (`status`, `amount`, `expected_close_date`, `closed_at`).

Não reintroduza uma segunda fonte para o estágio do funil.

## Regras do banco que o código depende

- **`status`, `origin`, `priority` e `gateway` têm CHECK constraint.** Adicionar um valor novo na interface sem a migration correspondente faz o insert falhar em produção. Os valores vivem em `lib/constants.ts` (`ORIGINS`, `KANBAN_STATUSES`, `PRIORITIES`) — a interface é gerada a partir deles, então acrescentar lá propaga sozinho.
- **Índices únicos já normalizam na expressão:** `lower(email)` e `regexp_replace(phone,'\D','','g')`. Formatação diferente do mesmo telefone não duplica. O que ainda duplica é código de país — `+55...` e `62...` são chaves diferentes.
- **Trigger `set_contact_closed_at`** preenche `closed_at` sozinho quando o status vira `Cliente`/`Inativo`/`Arquivado`. Não precisa setar na mão.
- **RLS ligada** em todas as tabelas, por `user_id`. Escrita automatizada (n8n) usa a chave `service_role` e define `user_id` explicitamente.

## Migrations

Ficam em `supabase/migrations/`, aplicadas por `supabase db push`. Padrão da casa: cabeçalho explicando **o problema que a migration resolve**, idempotente (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`) e normalização dos dados **antes** de aplicar a constraint, com catch-all para ela nunca falhar na aplicação.

## audit-gate.cjs

`npm run audit:gate` reprova avisos alto/crítico em dependências de produção. Exceções ficam declaradas no arquivo, com motivo e data de revisão, e o script avisa quando uma exceção deixa de corresponder a um aviso real.

**Nunca silencie um aviso com `continue-on-error` no workflow** — isso desliga o portão para todos os avisos futuros. Registre a exceção com justificativa.

Aberto hoje: `postcss` e `sharp`, ambos embutidos no Next 15. O de `sharp` tem caminho de entrada real (o Next otimiza avatares vindos do Storage) e é o que justifica priorizar a **migração para o Next 16**.

## Pendência conhecida

`package.json` ainda se chama `ai-studio-applet`, herança do template de origem.
