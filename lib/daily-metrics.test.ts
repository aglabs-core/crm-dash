import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectDailyMetrics } from './daily-metrics';
import { validateSnapshot } from './product-metrics';
const at = '2026-11-01T02:30:00.000Z';
const daily = { date: '2026-10-31', timeZone: 'America/Sao_Paulo', from: '2026-10-31T03:00:00.000Z', to: at, newUsers: 2, sales: 3, email: 'private@example.test' };
test('projects explicit daily counters through the real CRM snapshot and strips private fields', () => {
  const raw = { version: 1, product: 'viajeki', generatedAt: at, window: { from: at, to: at }, metrics: { users: 4, accounts: null, activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null }, daily };
  const result = validateSnapshot(raw, 'viajeki', Date.parse(at));
  assert.equal(result.daily?.newUsers, 2); assert.equal(result.daily?.sales, 3);
  assert.doesNotMatch(JSON.stringify(result), /private|email/);
  assert.equal(validateSnapshot({ ...raw, daily: undefined }, 'viajeki', Date.parse(at)).daily, undefined);
});
test('keeps zero distinct from unavailable and rejects mismatched day, timezone and inflated counts', () => {
  assert.deepEqual(projectDailyMetrics({ ...daily, sales: 0, newUsers: null }, at, 4), { date: daily.date, timeZone: daily.timeZone, from: daily.from, to: at, sales: 0, newUsers: null });
  for (const patch of [{ date: '2026-11-01' }, { from: '2026-10-01T03:00:00Z' }, { to: '2026-11-01T02:31:00Z' }, { timeZone: 'UTC' }, { newUsers: 5 }, { sales: -1 }, { sales: 1.5 }, { newUsers: undefined }]) assert.throws(() => projectDailyMetrics({ ...daily, ...patch }, at, 4));
});

test('registered purchase records survive projection without becoming confirmed sales', () => {
  const result = projectDailyMetrics({ ...daily, newUsers: null, sales: null, registeredPurchases: 1 }, at, null);
  assert.equal(result.registeredPurchases, 1); assert.equal(result.sales, null); assert.equal(result.newUsers, null);
});
