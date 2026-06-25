// Pure analytics over deals/tasks. This is where the data-honesty bugs are
// fixed once and reused by the dashboard and reports:
//  - revenue attributed by closed_at (not created_at)
//  - month buckets keyed by year+month (no more collapsing Jan/25 into Jan/26)
//  - win-rate and sales-cycle computed from real closed deals

import type { Deal, Task } from './types';
import { OPEN_STAGES } from './constants';

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const amount = (d: Deal) => Number(d.amount) || 0;

export const isWon = (d: Deal) => d.stage === 'Ganho';
export const isLost = (d: Deal) => d.stage === 'Perdido';
export const isOpen = (d: Deal) => d.stage !== 'Ganho' && d.stage !== 'Perdido';

export function totalRevenue(deals: Deal[]): number {
  return deals.filter(isWon).reduce((s, d) => s + amount(d), 0);
}

export function pipelineValue(deals: Deal[]): number {
  return deals.filter(isOpen).reduce((s, d) => s + amount(d), 0);
}

export function openDealsCount(deals: Deal[]): number {
  return deals.filter(isOpen).length;
}

/** Win-rate over closed deals. Null when nothing has closed yet (honest). */
export function winRate(deals: Deal[]): number | null {
  const won = deals.filter(isWon).length;
  const lost = deals.filter(isLost).length;
  const closed = won + lost;
  return closed === 0 ? null : (won / closed) * 100;
}

export function avgDealSize(deals: Deal[]): number {
  const won = deals.filter(isWon);
  if (won.length === 0) return 0;
  return won.reduce((s, d) => s + amount(d), 0) / won.length;
}

/** Average days from creation to close for won deals. Null when none. */
export function avgSalesCycleDays(deals: Deal[]): number | null {
  const won = deals.filter((d) => isWon(d) && d.closed_at && d.created_at);
  if (won.length === 0) return null;
  const total = won.reduce((s, d) => {
    const start = new Date(d.created_at as string).getTime();
    const end = new Date(d.closed_at as string).getTime();
    return s + Math.max(0, (end - start) / 86_400_000);
  }, 0);
  return total / won.length;
}

export type MonthPoint = {
  key: string; // YYYY-MM for sorting
  name: string; // e.g. "Jun/26"
  revenue: number; // won value, by closed_at
  lost: number; // lost value, by closed_at
  pipeline: number; // open value, by created_at
  wonCount: number;
  lostCount: number;
  rate: number | null; // win-rate % for the month
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
const monthLabel = (d: Date) => `${MONTHS_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

/** Year-aware monthly series seeded with the last `months` months. */
export function monthlySeries(deals: Deal[], months = 6): MonthPoint[] {
  const buckets = new Map<string, MonthPoint>();
  const now = new Date();

  const blank = (d: Date): MonthPoint => ({
    key: monthKey(d),
    name: monthLabel(d),
    revenue: 0,
    lost: 0,
    pipeline: 0,
    wonCount: 0,
    lostCount: 0,
    rate: null,
  });

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), blank(d));
  }
  const ensure = (d: Date) => {
    const k = monthKey(d);
    let b = buckets.get(k);
    if (!b) {
      b = blank(d);
      buckets.set(k, b);
    }
    return b;
  };

  for (const deal of deals) {
    if (isWon(deal) && deal.closed_at) {
      const b = ensure(new Date(deal.closed_at));
      b.revenue += amount(deal);
      b.wonCount += 1;
    } else if (isLost(deal) && deal.closed_at) {
      const b = ensure(new Date(deal.closed_at));
      b.lost += amount(deal);
      b.lostCount += 1;
    }
    if (isOpen(deal) && deal.created_at) {
      const b = ensure(new Date(deal.created_at));
      b.pipeline += amount(deal);
    }
  }

  const points = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const p of points) {
    const closed = p.wonCount + p.lostCount;
    p.rate = closed ? Math.round((p.wonCount / closed) * 100) : null;
  }
  return points;
}

export type StageDatum = { stage: string; label: string; count: number; value: number; tone: string };

/** Open pipeline by stage, in funnel order. */
export function pipelineByStage(deals: Deal[]): StageDatum[] {
  return OPEN_STAGES.map((s) => {
    const inStage = deals.filter((d) => d.stage === s.id);
    return {
      stage: s.id,
      label: s.label,
      count: inStage.length,
      value: inStage.reduce((x, d) => x + amount(d), 0),
      tone: s.tone,
    };
  });
}

export type ProductDatum = { produto: string; revenue: number; count: number };

/** Won revenue grouped by deal product. */
export function revenueByProduct(deals: Deal[]): ProductDatum[] {
  const map = new Map<string, ProductDatum>();
  for (const d of deals.filter(isWon)) {
    const key = d.produto?.trim() || 'Sem produto';
    const cur = map.get(key) ?? { produto: key, revenue: 0, count: 0 };
    cur.revenue += amount(d);
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export function winLossCounts(deals: Deal[]): { won: number; lost: number } {
  return { won: deals.filter(isWon).length, lost: deals.filter(isLost).length };
}

/** Distinct, non-empty product names across deals (for filters). */
export function uniqueProducts(deals: Pick<Deal, 'produto'>[]): string[] {
  return Array.from(new Set(deals.map((d) => d.produto?.trim()).filter((p): p is string => !!p))).sort();
}

// ---- Tasks ----------------------------------------------------------------

export function isTaskOverdue(t: Task): boolean {
  if (t.status === 'completed' || !t.due_date) return false;
  const due = new Date(t.due_date);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

export function isTaskDueToday(t: Task): boolean {
  if (t.status === 'completed' || !t.due_date) return false;
  const due = new Date(t.due_date);
  const now = new Date();
  return (
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate()
  );
}

// ---- Period filtering (reports) -------------------------------------------

/** Keep deals created within the last `days` (null = all time). */
export function filterDealsByPeriod(deals: Deal[], days: number | null): Deal[] {
  if (!days) return deals;
  const cutoff = Date.now() - days * 86_400_000;
  return deals.filter((d) => (d.created_at ? new Date(d.created_at).getTime() >= cutoff : false));
}

/** Deals expected to close within the next `days`, still open. */
export function dealsClosingSoon(deals: Deal[], days = 30): Deal[] {
  const now = Date.now();
  const horizon = now + days * 86_400_000;
  return deals
    .filter((d) => isOpen(d) && d.expected_close_date)
    .filter((d) => {
      const t = new Date(d.expected_close_date as string).getTime();
      return t >= now - 86_400_000 && t <= horizon;
    })
    .sort(
      (a, b) =>
        new Date(a.expected_close_date as string).getTime() -
        new Date(b.expected_close_date as string).getTime(),
    );
}
