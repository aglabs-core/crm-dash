import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commerceEvents } from './commerce-funnel';
import { productMetrics, validateSnapshot } from './product-metrics';

const snapshot = () => ({ version: 1, product: 'vibekit', generatedAt: '2026-10-26T09:00:00Z', window: { from: '2026-09-27T00:00:00Z', to: '2026-10-26T09:00:00Z' },
  metrics: { users: null, accounts: null, activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null },
  commerceFunnel: { version: 1, events: Object.fromEntries(commerceEvents.map(key => [key, 2])), observedFrom: '2026-10-25T00:00:00Z', registeredPurchases: 1, provisionedPurchases: 1, registeredCheckoutAmountCents: 9700, currency: 'BRL', basis: 'anonymous_event_counts_and_registered_live_checkout_records' } });

test('commerce metrics project only aggregates without inventing SaaS accounts or conversion ratios', () => {
  const raw = snapshot();
  const result = validateSnapshot({ ...raw, email: 'private@example.invalid', commerceFunnel: { ...raw.commerceFunnel, token: 'private', events: { ...raw.commerceFunnel.events, checkoutClicks: 50, email: 'private' } } }, 'vibekit');
  assert.equal(result.commerceFunnel?.events.checkoutClicks, 50);
  assert.equal(result.metrics.accounts, null);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(validateSnapshot({ ...raw, product: 'members' }, 'members').commerceFunnel, undefined);
  assert.equal(validateSnapshot({ ...raw, commerceFunnel: { ...raw.commerceFunnel, events: Object.fromEntries(commerceEvents.map(key => [key, null])), observedFrom: null } }, 'vibekit').commerceFunnel?.events.pageViews, null);
});

test('commerce contract rejects missing coverage, unsafe counts and unsupported monetary definitions', () => {
  const raw = snapshot();
  for (const change of [null, { ...raw.commerceFunnel, currency: 'USD' }, { ...raw.commerceFunnel, registeredPurchases: 0 }, { ...raw.commerceFunnel, provisionedPurchases: 2 }, { ...raw.commerceFunnel, registeredCheckoutAmountCents: Number.MAX_SAFE_INTEGER + 1 }, { ...raw.commerceFunnel, observedFrom: null }, { ...raw.commerceFunnel, observedFrom: '2027-01-01T00:00:00Z' }, { ...raw.commerceFunnel, events: { ...raw.commerceFunnel.events, pageViews: -1 } }, { ...raw.commerceFunnel, events: {} }]) {
    assert.throws(() => validateSnapshot({ ...raw, commerceFunnel: change }, 'vibekit'));
  }
  assert.throws(() => validateSnapshot({ ...raw, metrics: { ...raw.metrics, accounts: 1 } }, 'vibekit'));
});

test('VibeKit collection uses only its fixed HTTPS origin and reports missing configuration', async () => {
  const env = process.env.APP_METRICS_SOURCES, fetcher = globalThis.fetch;
  let calls = 0;
  try {
    delete process.env.APP_METRICS_SOURCES;
    assert.equal((await productMetrics('vibekit')).status, 'not_configured');
    globalThis.fetch = async () => { calls++; return Response.json({ ...snapshot(), generatedAt: new Date().toISOString() }); };
    for (const url of ['https://example.invalid/api/integrations/crm/metrics', 'https://templates.aglabs.ia.br/api/integrations/crm/metrics?token=x']) {
      process.env.APP_METRICS_SOURCES = JSON.stringify([{ product: 'vibekit', url, token: 'x'.repeat(32) }]);
      assert.equal((await productMetrics('vibekit')).status, 'unavailable');
    }
    assert.equal(calls, 0);
    process.env.APP_METRICS_SOURCES = JSON.stringify([{ product: 'vibekit', url: 'https://templates.aglabs.ia.br/api/integrations/crm/metrics', token: 'x'.repeat(32) }]);
    const live = snapshot(); live.generatedAt = live.window.to = new Date().toISOString();
    globalThis.fetch = async () => Response.json(live);
    assert.equal((await productMetrics('vibekit')).status, 'ok');
  } finally { globalThis.fetch = fetcher; if (env === undefined) delete process.env.APP_METRICS_SOURCES; else process.env.APP_METRICS_SOURCES = env; }
});
