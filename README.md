<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CRM

CRM moderno e funcional para gestão de contatos, funil de vendas, tarefas e
relatórios — construído com **Next.js 15 (App Router)**, **React 19**,
**Supabase** (auth, Postgres, realtime), **Tailwind CSS v4** e **Recharts**.

## Funcionalidades

- **Dashboard** com métricas reais (receita por data de fechamento, pipeline,
  win/loss) e widgets acionáveis (tarefas vencidas, negócios fechando, parados).
- **Funil de vendas** Kanban com arrastar-e-soltar, incluindo o estágio
  `Perdido` (com motivo) para uma taxa de ganho honesta.
- **Contato 360°**: página de detalhe com negócios, tarefas e uma linha do
  tempo de atividades (notas, ligações, e-mails, reuniões, mudanças de estágio).
- **Tarefas** vinculadas a contatos, com destaque de vencidas.
- **Relatórios** com win-rate e ciclo de vendas reais, gráficos por produto e
  exportação CSV.
- **Dark mode**, layout responsivo e busca global.

## Pré-requisitos

- Node.js 18+
- Um projeto [Supabase](https://supabase.com)

## Configuração

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie `.env.example` para `.env.local` e preencha as credenciais do Supabase:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL="https://<seu-projeto>.supabase.co"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="<sua-anon-key>"
   ```
3. Aplique as migrations do banco (em `supabase/migrations/`). Via Supabase CLI:
   ```bash
   supabase db push
   ```
   Ou cole o conteúdo dos arquivos `.sql` no **SQL Editor** do painel do Supabase,
   em ordem cronológica. A migration `..._professional_upgrade.sql` é idempotente
   e pode ser reaplicada com segurança.
4. Rode o app:
   ```bash
   npm run dev
   ```

## Modelo de dados

- **contacts** — pessoas/empresas (nome, email, telefone, empresa, status,
  produto, lp_url).
- **deals** — negócios do funil (título, valor, estágio, prioridade, produto,
  `closed_at`, `lost_reason`, vínculo opcional com um contato).
- **tasks** — tarefas (título, vencimento, status, prioridade, vínculo opcional
  com um contato).
- **activities** — linha do tempo por contato/negócio (nota, ligação, e-mail,
  reunião, mudança de estágio).

Todas as tabelas usam **Row Level Security**: cada usuário acessa apenas os
próprios dados.

## Scripts

| Comando         | Descrição                          |
| --------------- | ---------------------------------- |
| `npm run dev`   | Ambiente de desenvolvimento        |
| `npm run build` | Build de produção (com type-check) |
| `npm run start` | Servir o build de produção         |
| `npm run lint`  | ESLint                             |
