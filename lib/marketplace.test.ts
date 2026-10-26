import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSnapshot } from './product-metrics';

const from = '2026-10-01T03:00:00.000Z';
const generatedAt = new Date().toISOString();
const marketplace = () => ({
  version: 1, currency: 'BRL', basis: 'platform_financial_report_and_producer_status',
  currentMonth: { from, grossCents: 125000, platformFeeCents: 9800, paidItems: 14 },
  previousMonth: { from: '2026-09-01T03:00:00.000Z', to: from, grossCents: 90000, platformFeeCents: 7200, paidItems: 9 },
  producers: { onboarding: 40, approved: 12 },
  users: { total: 230, new30d: 31 },
});
const nulls = { accounts: null, activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null };
const snapshot = (overrides: Record<string, unknown> = {}) => ({ version: 1, product: 'members', generatedAt, window: { from, to: generatedAt }, metrics: { users: 230, ...nulls }, marketplace: marketplace(), ...overrides });

test('members marketplace block is validated and explicitly projected', () => {
  const raw = snapshot({ marketplace: { ...marketplace(), buyers: [{ email: 'private@example.invalid' }], producers: { onboarding: 40, approved: 12, names: ['private'] } } });
  const projected = validateSnapshot(raw, 'members');
  assert.deepEqual(projected.marketplace, marketplace());
  assert.equal(JSON.stringify(projected).includes('private'), false);
});

test('members without the block (current production endpoint) is still accepted', () => {
  const projected = validateSnapshot(snapshot({ marketplace: undefined }), 'members');
  assert.equal(projected.marketplace, undefined);
  assert.equal(projected.metrics.users, 230);
});

test('rejects SaaS numbers and inconsistent marketplace values', () => {
  assert.throws(() => validateSnapshot(snapshot({ metrics: { users: 230, ...nulls, payingAccounts: 5 } }), 'members'));
  assert.throws(() => validateSnapshot(snapshot({ metrics: { users: 229, ...nulls } }), 'members'));
  const bad = [
    { producers: { onboarding: 10, approved: 11 } },
    { producers: { onboarding: 300, approved: 1 } },
    { users: { total: 230, new30d: 231 } },
    { currentMonth: { from, grossCents: 100, platformFeeCents: 200, paidItems: 1 } },
    { currentMonth: { from, grossCents: 100, platformFeeCents: 10, paidItems: 0 } },
    { currentMonth: { from, grossCents: -1, platformFeeCents: 0, paidItems: 0 } },
    { currentMonth: { from: '2026-10-02T03:00:00.000Z', grossCents: 0, platformFeeCents: 0, paidItems: 0 } },
    { previousMonth: { from: '2026-09-01T03:00:00.000Z', to: '2026-09-30T03:00:00.000Z', grossCents: 0, platformFeeCents: 0, paidItems: 0 } },
    { currency: 'USD' },
    { version: 2 },
  ];
  for (const change of bad) assert.throws(() => validateSnapshot(snapshot({ marketplace: { ...marketplace(), ...change } }), 'members'), JSON.stringify(change));
  assert.throws(() => validateSnapshot(snapshot({ marketplace: null }), 'members'));
});

test('marketplace block is ignored for other products', () => {
  const barberias = { ...snapshot(), product: 'barberias', metrics: { users: 3, accounts: 2, activeAccounts: 1, trialAccounts: 1, payingAccounts: 0, complimentaryAccounts: 0, canceledAccounts: 0, activatedAccounts: null } };
  assert.equal(validateSnapshot(barberias, 'barberias').marketplace, undefined);
});
