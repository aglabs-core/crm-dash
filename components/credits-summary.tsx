import type { Credits } from '@/lib/credits';

const brl = (cents: number | null) => cents === null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('pt-BR');
const planNames = { basic: 'Básico', advanced: 'Advanced', premium: 'Premium' } as const;

export function CreditsSummary({ data }: { data: Credits }) {
  return <div className="mt-4 space-y-3">
    <dl className="grid grid-cols-2 gap-3">
      <div><dt className="text-xs text-muted">Receita em 30 dias</dt><dd className="text-xl font-semibold tabular-nums">{brl(data.sales.revenueCents)}</dd><dd className="text-xs text-muted">{n(data.sales.count)} compras · {n(data.sales.payingUsers)} compradores</dd></div>
      <div><dt className="text-xs text-muted">Assinaturas ativas</dt><dd className="text-xl font-semibold tabular-nums">{n(data.subscriptions?.active)}</dd><dd className="text-xs text-muted">{data.subscriptions ? `MRR estimado ${brl(data.subscriptions.mrrCents)} · ${n(data.subscriptions.trialing)} em teste` : 'seção indisponível no admin'}</dd></div>
      <div><dt className="text-xs text-muted">Usuários ativos em 30 dias</dt><dd className="text-xl font-semibold tabular-nums">{n(data.users.active30d)}</dd><dd className="text-xs text-muted">de {n(data.users.total)} · {n(data.users.generating)} geraram</dd></div>
      <div><dt className="text-xs text-muted">Créditos consumidos</dt><dd className="text-xl font-semibold tabular-nums">{n(data.credits?.consumed)}</dd><dd className="text-xs text-muted">{data.credits ? `vendidos ${n(data.credits.sold)} · bônus ${n(data.credits.bonus)}` : 'seção indisponível no admin'}</dd></div>
    </dl>
    {data.subscriptions && data.subscriptions.byPlan.length > 0 && <p className="text-xs text-muted">Por plano: {data.subscriptions.byPlan.map(p => `${planNames[p.plan]} ${n(p.active)}`).join(' · ')}</p>}
    <p className="text-xs leading-relaxed text-muted">Mesmos números da aba de 30 dias do admin do AG LABS App. {n(data.generations)} gerações no período. Receita é o valor registrado das compras sem reembolso aprovado; não é liquidação. Modelo de créditos: sem contas SaaS.</p>
  </div>;
}
