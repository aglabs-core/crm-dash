<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# CRM

CRM moderno e funcional para gestão de contatos, funil de vendas, tarefas e
relatórios — construído com **Next.js 15 (App Router)**, **React 19**,
**Supabase** (auth, Postgres, realtime), **Tailwind CSS v4** e **Recharts**.

## Funcionalidades

- **Dashboard** com métricas operacionais (recebimentos pelo ledger, pipeline,
  win/loss) e widgets acionáveis (tarefas vencidas, negócios fechando, parados).
- **Funil de vendas** Kanban com arrastar-e-soltar, incluindo o estágio
  `Arquivado` (com motivo) para uma taxa de ganho honesta. A base fria fica fora do funil.
- **Contato 360°**: página de detalhe com posição no funil, tarefas e uma linha do
  tempo de atividades (notas, ligações, e-mails, reuniões, mudanças de estágio).
- **Tarefas** vinculadas a contatos, com destaque de vencidas.
- **Relatórios** com win-rate e ciclo de vendas reais, gráficos por produto e
  exportação CSV.
- **Dark mode**, layout responsivo e busca global.
- **Visão operacional** em `/operations`: distribuição da carteira, qualidade da base e rotina de trabalho.
- **Financeiro** em `/finance`: pagamentos por mês/produto, devoluções e pendências de conferência. Controle fiscal persistente, despesas e conciliação bancária ainda não implementados.

Plano de evolução e limites: [revisão operacional e fiscal de 06/11/2026](docs/crm-operational-review-2026-11-06.md).

## Pré-requisitos

- Node.js 22 (mesma versão do CI)
- Um projeto [Supabase](https://supabase.com)

## Configuração

1. Instale as dependências:
   ```bash
   npm ci
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

- **contacts** — pessoas/empresas, posição no funil (`status`), valor estimado,
  produto, previsão de fechamento e histórico. A tabela `deals` foi eliminada;
  `/deals` é somente o endereço da interface Kanban.
- **payment_transactions** — pagamentos identificados por origem e transação,
  separados do valor estimado do contato; `net_amount` desconta devoluções, não taxas ou impostos.
- **leads_institucional** — entradas do site aguardando triagem/conversão.
- **email_messages / email_campaigns** — histórico de comunicação e campanhas.
- **tasks** — tarefas (título, vencimento, status, prioridade, vínculo opcional
  com um contato).
- **activities** — linha do tempo por contato/negócio (nota, ligação, e-mail,
  reunião, mudança de estágio).

As tabelas usam **Row Level Security**, com políticas de proprietário e acessos
administrativos explícitos. Dados de leads/clientes são privados; não exportar
cadastros, dumps ou payloads em logs/issues.

## Scripts

| Comando         | Descrição                          |
| --------------- | ---------------------------------- |
| `npm run dev`   | Ambiente de desenvolvimento        |
| `npm run build` | Build de produção (com type-check) |
| `npm run start` | Servir o build de produção         |
| `npm run lint`  | ESLint                             |
