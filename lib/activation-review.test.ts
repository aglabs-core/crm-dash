import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activationGaps } from './activation-review';
import type { ProductSnapshot } from './product-metrics';

const snapshot: ProductSnapshot = { version: 1, product: 'barberias', generatedAt: '2026-11-02T04:00:00Z', window: { from: '2026-10-03T04:00:00Z', to: '2026-11-02T04:00:00Z' }, metrics: { users: 40, accounts: 30, activeAccounts: 28, trialAccounts: 25, payingAccounts: 0, complimentaryAccounts: 3, canceledAccounts: 0, activatedAccounts: 5 }, activationFunnel: { professional: 25, catalog: 20, readyForBooking: 12, firstAppointment: 5 } };

test('Barberias gaps partition incomplete activation without double counting', () => {
  const gaps = activationGaps(snapshot);
  assert.deepEqual(gaps.map(gap => gap.count), [5, 5, 8, 7]);
  assert.equal(gaps.reduce((sum, gap) => sum + gap.count, 0), 30 - 5);
});

test('missing metrics and fully activated inventory do not invent a bottleneck', () => {
  assert.deepEqual(activationGaps({ ...snapshot, activationFunnel: undefined }), []);
  assert.deepEqual(activationGaps({ ...snapshot, activationFunnel: { professional: 30, catalog: 30, readyForBooking: 30, firstAppointment: 30 } }), []);
});

test('Members uses producers instead of treating all students as unactivated sellers', () => {
  const marketplace = { producers: { onboarding: 12, approved: 8 }, users: { total: 100, new30d: 2 } } as NonNullable<ProductSnapshot['marketplace']>;
  const gaps = activationGaps({ ...snapshot, product: 'members', activationFunnel: undefined, marketplace });
  assert.equal(gaps[0].count, 4);
});

test('freemium uses distinct publishers and creators, never number of pages or trips', () => {
  const freemium = { publishers: 8, publishedPages: 20, tripCreators: 7, trips: 100 } as NonNullable<ProductSnapshot['freemium']>;
  assert.equal(activationGaps({ ...snapshot, product: 'mecard', freemium })[0].count, 32);
  assert.equal(activationGaps({ ...snapshot, product: 'viajeki', freemium })[0].count, 33);
  assert.deepEqual(activationGaps({ ...snapshot, product: 'aglabs-app' }), []);
});
