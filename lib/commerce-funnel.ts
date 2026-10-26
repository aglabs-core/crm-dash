export const commerceEvents = ['pageViews', 'pricingViews', 'ctaClicks', 'checkoutClicks', 'checkoutCreated', 'checkoutFailures', 'successViews'] as const;
export type CommerceFunnel = {
  version: 1;
  events: Record<typeof commerceEvents[number], number | null>;
  observedFrom: string | null;
  registeredPurchases: number;
  provisionedPurchases: number;
  registeredCheckoutAmountCents: number | null;
  currency: 'BRL';
  basis: 'anonymous_event_counts_and_registered_live_checkout_records';
};

/** Closed projection: no customer identity or provider payload crosses the CRM. */
export function projectCommerceFunnel(raw: unknown, end: string): CommerceFunnel {
  const value = raw as CommerceFunnel;
  const count = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!value || value.version !== 1 || value.currency !== 'BRL' || value.basis !== 'anonymous_event_counts_and_registered_live_checkout_records'
    || !count(value.registeredPurchases) || !count(value.provisionedPurchases) || value.provisionedPurchases > value.registeredPurchases
    || (value.registeredCheckoutAmountCents !== null && !count(value.registeredCheckoutAmountCents))
    || (value.registeredPurchases === 0 && value.registeredCheckoutAmountCents !== 0)) throw new Error('Funil comercial inválido');
  const events = {} as CommerceFunnel['events'];
  for (const key of commerceEvents) {
    const n = value.events?.[key];
    if (n !== null && !count(n)) throw new Error('Evento inválido');
    events[key] = n;
  }
  const observed = value.observedFrom;
  if (observed !== null && (typeof observed !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(observed)
    || !Number.isFinite(Date.parse(observed)) || Date.parse(observed) > Date.parse(end))) throw new Error('Cobertura inválida');
  const known = Object.values(events).filter(n => n !== null).length;
  if ((known !== 0 && known !== commerceEvents.length) || (known > 0 && observed === null)) throw new Error('Cobertura inconsistente');
  // Event counts have no shared visitor/cohort denominator; never impose a conversion ordering.
  return { version: 1, events, observedFrom: observed, registeredPurchases: value.registeredPurchases,
    provisionedPurchases: value.provisionedPurchases, registeredCheckoutAmountCents: value.registeredCheckoutAmountCents,
    currency: 'BRL', basis: 'anonymous_event_counts_and_registered_live_checkout_records' };
}
