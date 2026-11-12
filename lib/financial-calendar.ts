export const BUSINESS_TIMEZONE = 'America/Sao_Paulo';
/** Shared calendar for reports, receipts and integrations. */
export function businessDate(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function businessMonth(value: string | Date): string | null { return businessDate(value)?.slice(0, 7) ?? null; }
