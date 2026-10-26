// Members é marketplace: unidade de negócio é o produtor; receita da plataforma vem das vendas.
type Period = { grossCents: number; platformFeeCents: number; paidItems: number };
export type Marketplace = {
  version: 1;
  currency: 'BRL';
  basis: 'platform_financial_report_and_producer_status';
  currentMonth: Period & { from: string };
  previousMonth: Period & { from: string; to: string };
  producers: { onboarding: number; approved: number };
  users: { total: number; new30d: number };
};

const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const iso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) && Number.isFinite(Date.parse(v));

function period(raw: unknown): Period {
  const p = raw as Period;
  if (!p || !count(p.grossCents) || !count(p.platformFeeCents) || !count(p.paidItems)
    || p.platformFeeCents > p.grossCents || (p.paidItems === 0 && p.grossCents !== 0)) throw new Error('Período inválido');
  return { grossCents: p.grossCents, platformFeeCents: p.platformFeeCents, paidItems: p.paidItems };
}

/** Projeção fechada: só agregados; nenhum pedido, produtor ou comprador atravessa o CRM. */
export function projectMarketplace(raw: unknown, window: { from: string; to: string }): Marketplace {
  const v = raw as Marketplace;
  if (!v || v.version !== 1 || v.currency !== 'BRL' || v.basis !== 'platform_financial_report_and_producer_status') throw new Error('Marketplace inválido');
  const cur = v.currentMonth, prev = v.previousMonth;
  if (!iso(cur?.from) || !iso(prev?.from) || !iso(prev?.to) || prev.to !== cur.from || Date.parse(prev.from) >= Date.parse(prev.to)
    || cur.from !== window.from || Date.parse(cur.from) > Date.parse(window.to)) throw new Error('Meses inválidos');
  const producers = v.producers, users = v.users;
  if (!producers || !count(producers.onboarding) || !count(producers.approved) || producers.approved > producers.onboarding) throw new Error('Produtores inválidos');
  if (!users || !count(users.total) || !count(users.new30d) || users.new30d > users.total || producers.onboarding > users.total) throw new Error('Usuários inválidos');
  return {
    version: 1, currency: 'BRL', basis: 'platform_financial_report_and_producer_status',
    currentMonth: { from: cur.from, ...period(cur) },
    previousMonth: { from: prev.from, to: prev.to, ...period(prev) },
    producers: { onboarding: producers.onboarding, approved: producers.approved },
    users: { total: users.total, new30d: users.new30d },
  };
}
