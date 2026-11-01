/** Explicit calendar-day aggregates, projected without identities or provider payloads. */
export type DailyMetrics = { date: string; timeZone: 'America/Sao_Paulo'; from: string; to: string; newUsers: number | null; sales: number | null; registeredPurchases?: number | null };
export function projectDailyMetrics(raw: unknown, generatedAt: string, users: number | null): DailyMetrics {
  const value = raw as DailyMetrics;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(generatedAt));
  const date = ['year','month','day'].map(key => parts.find(p => p.type === key)!.value).join('-');
  const start = `${date}T03:00:00.000Z`;
  const count = (n: unknown): number | null => {
    if (n === null) return null;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error('Agregado diário inválido');
    return n;
  };
  if (!value || value.date !== date || value.timeZone !== 'America/Sao_Paulo' || Date.parse(value.from) !== Date.parse(start) || value.to !== generatedAt) throw new Error('Janela diária inválida');
  const newUsers = count(value.newUsers), sales = count(value.sales);
  if (newUsers !== null && (users === null || newUsers > users)) throw new Error('Cadastros diários inválidos');
  return { date, timeZone: 'America/Sao_Paulo', from: start, to: generatedAt, newUsers, sales, ...(value.registeredPurchases === undefined ? {} : { registeredPurchases: count(value.registeredPurchases) }) };
}
