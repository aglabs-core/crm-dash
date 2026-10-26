import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSnapshot } from './product-metrics';

const at = new Date().toISOString();
const credits = () => ({
  version: 1, currency: 'BRL', basis: 'admin_analytics_30d',
  users: { total: 500, active30d: 120, generating: 90 },
  sales: { count: 30, payingUsers: 22, revenueCents: 123456 },
  subscriptions: { active: 18, trialing: 4, mrrCents: 81230, byPlan: [{ plan: 'basic', active: 10 }, { plan: 'premium', active: 8 }] },
  credits: { sold: 40000, purchased: 15000, bonus: 9000, consumed: 52000, refunded: 300 },
  generations: 3400,
});
const nulls = { accounts: null, activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null };
const snapshot = (overrides: Record<string, unknown> = {}) => ({ version: 1, product: 'aglabs-app', generatedAt: at, window: { from: new Date(Date.parse(at) - 30 * 86_400_000).toISOString(), to: at }, metrics: { users: 500, ...nulls }, credits: credits(), ...overrides });

test('aglabs-app credits block is validated and explicitly projected', () => {
  const raw = snapshot({ credits: { ...credits(), topConsumers: [{ email: 'private@example.invalid' }], users: { ...credits().users, emails: ['private'] } } });
  const out = validateSnapshot(raw, 'aglabs-app');
  assert.deepEqual(out.credits, credits());
  assert.equal(JSON.stringify(out).includes('private'), false);
});

test('unavailable admin sections stay null; snapshot without the block is accepted', () => {
  const out = validateSnapshot(snapshot({ credits: { ...credits(), subscriptions: null, credits: { ...credits().credits, bonus: null } } }), 'aglabs-app');
  assert.equal(out.credits?.subscriptions, null);
  assert.equal(out.credits?.credits?.bonus, null);
  assert.equal(validateSnapshot(snapshot({ credits: undefined }), 'aglabs-app').credits, undefined);
});

test('unknown price coverage preserves subscriptions without inventing MRR or a period', () => {
  const raw=snapshot({credits:{...credits(),subscriptions:{...credits().subscriptions,mrrCents:null}}});
  assert.equal(validateSnapshot(raw,'aglabs-app').credits?.subscriptions?.mrrCents,null);
  assert.equal(validateSnapshot(raw,'aglabs-app').credits?.subscriptions?.active,18);
  assert.throws(()=>validateSnapshot({...raw,window:{...raw.window,from:'2026-01-01T00:00:00.000Z'}},'aglabs-app'));
});

test('rejects SaaS numbers and inconsistent credits values', () => {
  assert.throws(() => validateSnapshot(snapshot({ metrics: { users: 500, ...nulls, payingAccounts: 18 } }), 'aglabs-app'));
  assert.throws(() => validateSnapshot(snapshot({ metrics: { users: 499, ...nulls } }), 'aglabs-app'));
  const bad = [
    { users: { total: 10, active30d: 11, generating: 1 } },
    { sales: { count: 3, payingUsers: 4, revenueCents: 100 } },
    { sales: { count: 0, payingUsers: 0, revenueCents: 100 } },
    { subscriptions: { active: 5, trialing: 0, mrrCents: 0, byPlan: [{ plan: 'basic', active: 6 }] } },
    { subscriptions: { active: 5, trialing: 0, mrrCents: 0, byPlan: [{ plan: 'gold', active: 1 }] } },
    { subscriptions: { active: 5, trialing: 0, mrrCents: 0, byPlan: [{ plan: 'basic', active: 1 }, { plan: 'basic', active: 1 }] } },
    { credits: { sold: -1, purchased: 0, bonus: 0, consumed: 0, refunded: 0 } },
    { generations: 1.5 },
    { basis: 'other' },
  ];
  for (const change of bad) assert.throws(() => validateSnapshot(snapshot({ credits: { ...credits(), ...change } }), 'aglabs-app'), JSON.stringify(change));
});

test('credits block is ignored for other products', () => {
  const mecard = { ...snapshot(), product: 'mecard', metrics: { users: 3, accounts: 3, ...{ activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null } } };
  assert.equal(validateSnapshot(mecard, 'mecard').credits, undefined);
});
