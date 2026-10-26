export type FreemiumMetrics = {
  version: 1; publishedPages: number | null; onlinePages: number | null; publishers: number | null;
  trips: number | null; tripCreators: number | null;
  subscriptionAccessUsers: number; paidSubscriptionUsers: number;
  proMonthly: number | null; proYearly: number | null; businessMonthly: number | null; businessYearly: number | null;
  tripPurchases30d: number | null; tripBuyers30d: number | null; tripRevenueCents30d: number | null;
  currency: "BRL"; basis: "current_records_and_confirmed_payments";
};
/** Closed aggregate projection. Null means not applicable, never zero inferred from missing data. */
export function projectFreemium(raw: unknown, product: string, users: number | null): FreemiumMetrics {
  if (!raw || typeof raw !== "object" || !["mecard", "viajeki"].includes(product) || users === null) throw new Error("Modelo freemium inválido");
  const v = raw as FreemiumMetrics;
  if (v.version !== 1 || v.currency !== "BRL" || v.basis !== "current_records_and_confirmed_payments") throw new Error("Contrato freemium inválido");
  const keys = ["publishedPages", "onlinePages", "publishers", "trips", "tripCreators", "subscriptionAccessUsers", "paidSubscriptionUsers", "proMonthly", "proYearly", "businessMonthly", "businessYearly", "tripPurchases30d", "tripBuyers30d", "tripRevenueCents30d"] as const;
  const counts = Object.fromEntries(keys.map(key => {
    const n = v[key];
    if (n !== null && (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)) throw new Error("Contagem freemium inválida");
    return [key, n];
  })) as Pick<FreemiumMetrics, typeof keys[number]>;
  const required = product === "mecard" ? ["publishedPages", "onlinePages", "publishers", "subscriptionAccessUsers", "paidSubscriptionUsers", "proMonthly", "proYearly", "businessMonthly", "businessYearly"] as const : ["trips", "tripCreators", "subscriptionAccessUsers", "paidSubscriptionUsers", "proYearly", "tripPurchases30d", "tripBuyers30d", "tripRevenueCents30d"] as const;
  if (keys.some(key => required.includes(key as never) ? counts[key] === null : counts[key] !== null)) throw new Error("Unidade freemium divergente");
  for (const key of ["publishers", "tripCreators", "subscriptionAccessUsers", "paidSubscriptionUsers", "tripBuyers30d"] as const) if (counts[key] !== null && counts[key]! > users) throw new Error("Usuários divergentes");
  const paidPlans = [counts.proMonthly, counts.proYearly, counts.businessMonthly, counts.businessYearly].reduce<number>((sum,n) => sum + (n ?? 0), 0);
  if (paidPlans !== counts.paidSubscriptionUsers || counts.paidSubscriptionUsers > counts.subscriptionAccessUsers) throw new Error("Assinantes divergentes");
  if (product === "mecard" && (counts.onlinePages! > counts.publishedPages! || counts.publishers! > counts.publishedPages!)) throw new Error("Publicações divergentes");
  if (product === "viajeki" && (counts.tripCreators! > counts.trips! || counts.tripBuyers30d! > counts.tripPurchases30d! || (counts.tripPurchases30d === 0 && counts.tripRevenueCents30d !== 0))) throw new Error("Compras divergentes");
  return { version: 1, ...counts, currency: "BRL", basis: "current_records_and_confirmed_payments" };
}
