import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecosystemOverview } from './ecosystem';
test('product-wide data requires administrator access before collection', async () => {
  let collected = 0;
  const dependencies = { authorize: async () => false, metrics: async () => { collected++; throw new Error('must not run'); } };
  const anon = await ecosystemOverview(new Request('https://crm.test/api/ecosystem'), dependencies);
  assert.equal(anon.status, 401);
  const denied = await ecosystemOverview(new Request('https://crm.test/api/ecosystem', { headers: { authorization: 'Bearer fixture' } }), dependencies);
  assert.equal(denied.status, 403); assert.equal(collected, 0);
});
test('authorized requests collect only registered products and preserve unavailable state', async () => {
  const seen: string[] = [];
  const response = await ecosystemOverview(new Request('https://crm.test/api/ecosystem', { headers: { authorization: 'Bearer fixture' } }), {
    authorize: async () => true,
    metrics: async product => { seen.push(product); return { status: 'not_configured', checkedAt: new Date().toISOString(), data: null, message: 'Sem coleta', via: 'crm' }; },
  });
  assert.deepEqual(seen, ['barberias', 'mecard', 'members', 'vibekit']);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json(); assert.equal(body.products[0].data, null);
});
