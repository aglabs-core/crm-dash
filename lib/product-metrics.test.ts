import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productMetrics, validateSnapshot } from './product-metrics';
const snapshot = () => ({ version: 1, product: 'barberias', generatedAt: new Date().toISOString(), window: { from: '2026-01-01T00:00:00Z', to: new Date().toISOString() }, metrics: { users: 3, accounts: 2, activeAccounts: 1, trialAccounts: 1, payingAccounts: 0, complimentaryAccounts: 0, canceledAccounts: 0, activatedAccounts: null } });
test('projects aggregates without private fields and validates product and counts', () => {
  const result = validateSnapshot({ ...snapshot(), email: 'private@example.com' }, 'barberias');
  assert.equal(result.metrics.activatedAccounts, null);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.throws(() => validateSnapshot(snapshot(), 'members'));
  assert.throws(() => validateSnapshot({ ...snapshot(), metrics: { ...snapshot().metrics, users: -1 } }, 'barberias'));
});
test('collects only the fixed authenticated origin with bounded payload', async () => {
  const original = process.env.APP_METRICS_SOURCES; const fetcher = globalThis.fetch;
  try {
    delete process.env.APP_METRICS_SOURCES;
    assert.equal((await productMetrics('barberias')).status, 'not_configured');
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(snapshot()); };
    for (const url of ['http://barberias.com.br/api/integrations/orbita/metrics', 'https://other.example/api/integrations/orbita/metrics', 'https://barberias.com.br/api/integrations/orbita/metrics?token=x']) {
      process.env.APP_METRICS_SOURCES = JSON.stringify([{ product: 'barberias', url, token: 'x'.repeat(32) }]);
      assert.equal((await productMetrics('barberias')).status, 'unavailable');
    }
    assert.equal(calls, 0);
    process.env.APP_METRICS_SOURCES = JSON.stringify([{ product: 'barberias', url: 'https://barberias.com.br/api/integrations/orbita/metrics', token: 'x'.repeat(32) }]);
    assert.equal((await productMetrics('barberias')).status, 'ok');
    globalThis.fetch = async () => new Response('x'.repeat(32769));
    assert.equal((await productMetrics('barberias')).status, 'unavailable');
    globalThis.fetch = async () => { throw new Error('fixture-secret'); };
    assert.equal(JSON.stringify(await productMetrics('barberias')).includes('fixture-secret'), false);
  } finally { globalThis.fetch = fetcher; if (original === undefined) delete process.env.APP_METRICS_SOURCES; else process.env.APP_METRICS_SOURCES = original; }
});

test('registered applications have separate fixed origins and explicit unknown metrics', async () => {
  const original = process.env.APP_METRICS_SOURCES, fetcher = globalThis.fetch;
  try {
    for (const [product, host] of [['mecard', 'mecard.com.br'], ['members', 'members.ia.br']]) {
      process.env.APP_METRICS_SOURCES = JSON.stringify([{ product, url: `https://${host}/api/integrations/crm/metrics`, token: 'x'.repeat(32) }]);
      globalThis.fetch = async () => Response.json({ ...snapshot(), product, metrics: { ...snapshot().metrics, payingAccounts: null } });
      assert.equal((await productMetrics(product)).status, 'ok');
      globalThis.fetch = async () => Response.json(snapshot());
      assert.equal((await productMetrics(product)).status, 'unavailable');
    }
  } finally { globalThis.fetch = fetcher; if (original === undefined) delete process.env.APP_METRICS_SOURCES; else process.env.APP_METRICS_SOURCES = original; }
});
