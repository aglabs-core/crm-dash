// Pure analytics over the contact-centric pipeline. The contact IS the funnel
// unit now: it carries `status` (funnel position) and `amount`/`closed_at`.
// This keeps the data honest and reused by dashboard, reports, clients.
//  - revenue attributed by closed_at (not created_at)
//  - month buckets keyed by year+month
//  - win-rate and sales-cycle computed from real closed contacts

import type { Contact, ContactStatus, PaymentTransaction, Task } from './types';
import { paymentMonthRevenue } from './payment-analytics';
import { KANBAN_STATUSES, isClientStatus, isArchivedStatus, isActiveStatus, type Tone } from './constants';

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const amount = (c: Contact) => Number(c.amount) || 0;

/** Won = a client (active or inactive). Lost = archived. Open = active funnel. */
export const isWon = (c: Contact) => isClientStatus(c.status);
export const isLost = (c: Contact) => isArchivedStatus(c.status);
export const isOpen = (c: Contact) => isActiveStatus(c.status);

export function totalRevenue(contacts: Contact[]): number {
  return contacts.filter(isWon).reduce((s, c) => s + amount(c), 0);
}

export function pipelineValue(contacts: Contact[]): number {
  return contacts.filter(isOpen).reduce((s, c) => s + amount(c), 0);
}

export function openDealsCount(contacts: Contact[]): number {
  return contacts.filter(isOpen).length;
}

/** Win-rate over closed contacts. Null when nothing has closed yet (honest). */
export function winRate(contacts: Contact[]): number | null {
  const won = contacts.filter(isWon).length;
  const lost = contacts.filter(isLost).length;
  const closed = won + lost;
  return closed === 0 ? null : (won / closed) * 100;
}

export function avgDealSize(contacts: Contact[]): number {
  const won = contacts.filter(isWon);
  if (won.length === 0) return 0;
  return won.reduce((s, c) => s + amount(c), 0) / won.length;
}

/** Average days from creation to close for won contacts. Null when none. */
export function avgSalesCycleDays(contacts: Contact[]): number | null {
  const won = contacts.filter((c) => isWon(c) && c.closed_at && c.created_at);
  if (won.length === 0) return null;
  const total = won.reduce((s, c) => {
    const start = new Date(c.created_at as string).getTime();
    const end = new Date(c.closed_at as string).getTime();
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
  newCount: number; // contacts created in the month
  wonCount: number;
  lostCount: number;
  rate: number | null; // win-rate % for the month
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
const monthLabel = (d: Date) => `${MONTHS_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

/**
 * Year-aware monthly series, strictly bounded to the last `months` months
 * (rolling window) so the chart length matches its label.
 */
export function monthlySeries(contacts: Contact[], months = 6, payments?: PaymentTransaction[]): MonthPoint[] {
  const buckets = new Map<string, MonthPoint>();
  const order: string[] = [];
  const now = new Date();

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = monthKey(d);
    order.push(k);
    buckets.set(k, {
      key: k,
      name: monthLabel(d),
      revenue: 0,
      lost: 0,
      pipeline: 0,
      newCount: 0,
      wonCount: 0,
      lostCount: 0,
      rate: null,
    });
  }

  const at = (dateStr: string | null | undefined, fn: (b: MonthPoint) => void) => {
    if (!dateStr) return;
    const b = buckets.get(monthKey(new Date(dateStr)));
    if (b) fn(b);
  };

  for (const c of contacts) {
    if (isWon(c)) {
      at(c.closed_at, (b) => {
        if (!payments) b.revenue += amount(c);
        b.wonCount += 1;
      });
    } else if (isLost(c)) {
      at(c.closed_at, (b) => {
        b.lost += amount(c);
        b.lostCount += 1;
      });
    }
    if (isOpen(c)) at(c.created_at, (b) => (b.pipeline += amount(c)));
    at(c.created_at, (b) => (b.newCount += 1));
  }

  const points = order.map((k) => buckets.get(k) as MonthPoint);
  for (const p of points) {
    if (payments) {
      const [year, month] = p.key.split('-').map(Number);
      p.revenue = paymentMonthRevenue(payments, year, month);
    }
    const closed = p.wonCount + p.lostCount;
    p.rate = closed ? Math.round((p.wonCount / closed) * 100) : null;
  }
  return points;
}

export type StageDatum = { stage: string; label: string; count: number; value: number; tone: string };

/** Open pipeline by stage, in funnel order (the active Kanban stages). */
export function pipelineByStage(contacts: Contact[]): StageDatum[] {
  return KANBAN_STATUSES.map((s) => {
    const inStage = contacts.filter((c) => c.status === s.id);
    return {
      stage: s.id,
      label: s.label,
      count: inStage.length,
      value: inStage.reduce((x, c) => x + amount(c), 0),
      tone: s.tone,
    };
  });
}

export type FunnelStageDatum = {
  stage: string;
  label: string;
  reached: number; // contacts that reached at least this stage
  value: number; // open/won amount at or beyond this stage
  tone: Tone;
};

/**
 * Cumulative conversion funnel built from current statuses. A contact at a later
 * stage (or already won) is counted as having "reached" every earlier stage, so
 * the result is a strictly descending funnel — Lead (everyone still in play) down
 * to Cliente (won). Lost/archived contacts drop out and are excluded.
 * This is the honest way to turn status snapshots into a conversion funnel.
 */
export function conversionFunnel(contacts: Contact[]): FunnelStageDatum[] {
  const active = KANBAN_STATUSES; // Lead → Pagamento, in order
  const indexOf = new Map(active.map((s, i) => [s.id, i]));
  const here = active.map(() => 0);
  const hereValue = active.map(() => 0);
  let wonCount = 0;
  let wonValue = 0;

  for (const c of contacts) {
    if (isWon(c)) {
      wonCount += 1;
      wonValue += amount(c);
      continue;
    }
    const i = indexOf.get(c.status as ContactStatus);
    if (i === undefined) continue; // lost / unknown → not in the funnel
    here[i] += 1;
    hereValue[i] += amount(c);
  }

  // Accumulate from the bottom up; won contacts have passed every active stage.
  const stages: FunnelStageDatum[] = [];
  let reached = wonCount;
  let reachedValue = wonValue;
  for (let i = active.length - 1; i >= 0; i--) {
    reached += here[i];
    reachedValue += hereValue[i];
    stages.push({
      stage: active[i].id,
      label: active[i].label,
      reached,
      value: reachedValue,
      tone: active[i].tone,
    });
  }
  stages.reverse();
  stages.push({ stage: 'Cliente', label: 'Cliente', reached: wonCount, value: wonValue, tone: 'emerald' });
  return stages;
}

export type ProductDatum = { produto: string; revenue: number; count: number };

/** Won revenue grouped by product. */
export function revenueByProduct(contacts: Contact[]): ProductDatum[] {
  const map = new Map<string, ProductDatum>();
  for (const c of contacts.filter(isWon)) {
    const key = c.produto?.trim() || 'Sem produto';
    const cur = map.get(key) ?? { produto: key, revenue: 0, count: 0 };
    cur.revenue += amount(c);
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export function winLossCounts(contacts: Contact[]): { won: number; lost: number } {
  return { won: contacts.filter(isWon).length, lost: contacts.filter(isLost).length };
}

/** Distinct, non-empty product names (for filters). */
export function uniqueProducts(contacts: Pick<Contact, 'produto'>[]): string[] {
  return Array.from(
    new Set(contacts.map((c) => c.produto?.trim()).filter((p): p is string => !!p)),
  ).sort();
}

export type ProductPerf = {
  produto: string;
  deals: number; // total contacts for the product
  open: number; // open count
  openValue: number; // open pipeline value
  won: number; // won count
  wonValue: number; // won revenue
  lost: number; // lost count
  rate: number | null; // win-rate % over closed
};

/**
 * Full per-product performance across the funnel — the data behind the
 * "leads/negócios por produto" report. Sorted by won revenue, then volume.
 */
export function productPerformance(contacts: Contact[]): ProductPerf[] {
  const map = new Map<string, ProductPerf>();
  for (const c of contacts) {
    const key = c.produto?.trim() || 'Sem produto';
    const cur =
      map.get(key) ??
      { produto: key, deals: 0, open: 0, openValue: 0, won: 0, wonValue: 0, lost: 0, rate: null };
    cur.deals += 1;
    if (isWon(c)) {
      cur.won += 1;
      cur.wonValue += amount(c);
    } else if (isLost(c)) {
      cur.lost += 1;
    } else {
      cur.open += 1;
      cur.openValue += amount(c);
    }
    map.set(key, cur);
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const closed = r.won + r.lost;
    r.rate = closed ? Math.round((r.won / closed) * 100) : null;
  }
  return rows.sort((a, b) => b.wonValue - a.wonValue || b.deals - a.deals);
}

/** Count of leads (contacts) per product — top of funnel, by volume. */
export function leadsByProduct(contacts: Pick<Contact, 'produto'>[]): { produto: string; count: number }[] {
  const map = new Map<string, number>();
  for (const c of contacts) {
    const key = c.produto?.trim() || 'Sem produto';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([produto, count]) => ({ produto, count }))
    .sort((a, b) => b.count - a.count);
}

// ---- Clients --------------------------------------------------------------

export type ClientRow = {
  contact: Contact;
  wonRevenue: number;
  active: boolean;
  products: string[];
  lastWonAt: string | null;
};

/** Clients = contacts whose status is Cliente (active) or Inativo (inactive). */
export function buildClients(contacts: Contact[]): ClientRow[] {
  return contacts
    .filter(isWon)
    .map((contact) => ({
      contact,
      wonRevenue: amount(contact),
      active: contact.status === 'Cliente',
      products: contact.produto ? [contact.produto.trim()] : [],
      lastWonAt: contact.closed_at || contact.updated_at || null,
    }))
    .sort((a, b) => b.wonRevenue - a.wonRevenue);
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

/** Keep contacts created within the last `days` (null = all time). */
export function filterByPeriod<T extends { created_at?: string }>(rows: T[], days: number | null): T[] {
  if (!days) return rows;
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter((r) => (r.created_at ? new Date(r.created_at).getTime() >= cutoff : false));
}

/** Contacts expected to close within the next `days`, still open. */
export function closingSoon(contacts: Contact[], days = 30): Contact[] {
  const now = Date.now();
  const horizon = now + days * 86_400_000;
  return contacts
    .filter((c) => isOpen(c) && c.expected_close_date)
    .filter((c) => {
      const t = new Date(c.expected_close_date as string).getTime();
      return t >= now - 86_400_000 && t <= horizon;
    })
    .sort(
      (a, b) =>
        new Date(a.expected_close_date as string).getTime() -
        new Date(b.expected_close_date as string).getTime(),
    );
}
