// AG LABS App vende créditos (assinatura mensal com créditos ou pacote avulso); não é SaaS por conta.
const PLANS = ['basic', 'advanced', 'premium'] as const;
type Plan = typeof PLANS[number];
export type Credits = {
  version: 1;
  currency: 'BRL';
  basis: 'admin_analytics_30d';
  users: { total: number; active30d: number; generating: number };
  sales: { count: number; payingUsers: number; revenueCents: number };
  subscriptions: { active: number; trialing: number; mrrCents: number | null; byPlan: { plan: Plan; active: number }[] } | null;
  credits: { sold: number; purchased: number; bonus: number | null; consumed: number; refunded: number } | null;
  generations: number;
};

const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function need(n: unknown): number { if (!count(n)) throw new Error('Contagem de créditos inválida'); return n; }

/** Projeção fechada: só agregados; nenhum usuário, ranking ou pedido atravessa o CRM. */
export function projectCredits(raw: unknown): Credits {
  const v = raw as Credits;
  if (!v || v.version !== 1 || v.currency !== 'BRL' || v.basis !== 'admin_analytics_30d') throw new Error('Créditos inválidos');
  const users = { total: need(v.users?.total), active30d: need(v.users?.active30d), generating: need(v.users?.generating) };
  if (users.active30d > users.total || users.generating > users.total) throw new Error('Usuários inválidos');
  const sales = { count: need(v.sales?.count), payingUsers: need(v.sales?.payingUsers), revenueCents: need(v.sales?.revenueCents) };
  if (sales.payingUsers > sales.count || sales.payingUsers > users.total || (sales.count === 0 && sales.revenueCents !== 0)) throw new Error('Vendas inválidas');
  let subscriptions: Credits['subscriptions'] = null;
  if (v.subscriptions !== null) {
    const s = v.subscriptions;
    if (!s || !Array.isArray(s.byPlan) || s.byPlan.length > PLANS.length) throw new Error('Assinaturas inválidas');
    const byPlan = s.byPlan.map(p => { if (!PLANS.includes(p?.plan)) throw new Error('Plano inválido'); return { plan: p.plan, active: need(p.active) }; });
    if (new Set(byPlan.map(p => p.plan)).size !== byPlan.length || byPlan.reduce((sum, p) => sum + p.active, 0) > need(s.active)) throw new Error('Planos inválidos');
    subscriptions = { active: need(s.active), trialing: need(s.trialing), mrrCents: s.mrrCents === null ? null : need(s.mrrCents), byPlan };
  }
  let credits: Credits['credits'] = null;
  if (v.credits !== null) {
    const c = v.credits;
    if (!c || (c.bonus !== null && !count(c.bonus))) throw new Error('Créditos inválidos');
    credits = { sold: need(c.sold), purchased: need(c.purchased), bonus: c.bonus, consumed: need(c.consumed), refunded: need(c.refunded) };
  }
  return { version: 1, currency: 'BRL', basis: 'admin_analytics_30d', users, sales, subscriptions, credits, generations: need(v.generations) };
}
