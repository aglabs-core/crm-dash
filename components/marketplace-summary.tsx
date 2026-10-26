import type { Marketplace } from '@/lib/marketplace';

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v: number) => v.toLocaleString('pt-BR');

export function MarketplaceSummary({ data }: { data: Marketplace }) {
  const { currentMonth: cur, previousMonth: prev } = data;
  return <div className="mt-4 space-y-3">
    <dl className="grid grid-cols-2 gap-3">
      <div><dt className="text-xs text-muted">Faturamento bruto no mês</dt><dd className="text-xl font-semibold tabular-nums">{brl(cur.grossCents)}</dd><dd className="text-xs text-muted">{n(cur.paidItems)} vendas · mês anterior {brl(prev.grossCents)}</dd></div>
      <div><dt className="text-xs text-muted">Receita da plataforma no mês</dt><dd className="text-xl font-semibold tabular-nums">{brl(cur.platformFeeCents)}</dd><dd className="text-xs text-muted">mês anterior {brl(prev.platformFeeCents)}</dd></div>
      <div><dt className="text-xs text-muted">Produtores aprovados</dt><dd className="text-xl font-semibold tabular-nums">{n(data.producers.approved)}</dd><dd className="text-xs text-muted">de {n(data.producers.onboarding)} com cadastro iniciado</dd></div>
      <div><dt className="text-xs text-muted">Usuários</dt><dd className="text-xl font-semibold tabular-nums">{n(data.users.total)}</dd><dd className="text-xs text-muted">{n(data.users.new30d)} novos em 30 dias</dd></div>
    </dl>
    <p className="text-xs leading-relaxed text-muted">Mesma fonte do painel administrativo do Members. Mês atual parcial; mês anterior completo. Receita da plataforma inclui produtos próprios e comissões, com valores conciliados ou estimados e estornos alocados conforme o relatório; não comprova liquidação nem saldo disponível. Marketplace não tem contas de assinatura.</p>
  </div>;
}
