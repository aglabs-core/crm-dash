export type Audience = {
  version: 1; active30d: number | null; newMonth: number | null;
  monthFrom: string; activityFrom: string; to: string;
  timeZone: 'America/Sao_Paulo'; activityBasis: 'authenticated_product_events' | null;
};

/** Closed projection of counts; never forward identities or arbitrary metadata. */
export function projectAudience(raw: unknown, users: number | null, generatedAt: string): Audience {
  const v = raw as Audience;
  const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
  const count = (value: unknown) => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && users !== null && value <= users);
  if (!v || v.version !== 1 || v.timeZone !== 'America/Sao_Paulo' || !date(v.to) || !date(v.monthFrom) || !date(v.activityFrom)
    || v.to !== generatedAt || !count(v.active30d) || !count(v.newMonth)
    || (v.active30d === null ? v.activityBasis !== null : v.activityBasis !== 'authenticated_product_events')) throw new Error('Audiência inválida');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(v.to));
  const monthStart = Date.UTC(Number(parts.find(p => p.type === 'year')!.value), Number(parts.find(p => p.type === 'month')!.value) - 1, 1, 3);
  if (Date.parse(v.monthFrom) !== monthStart || Date.parse(v.to) - Date.parse(v.activityFrom) !== 30 * 86_400_000) throw new Error('Janela de audiência inválida');
  return { version: 1, active30d: v.active30d, newMonth: v.newMonth, monthFrom: v.monthFrom, activityFrom: v.activityFrom, to: v.to, timeZone: 'America/Sao_Paulo', activityBasis: v.activityBasis };
}
