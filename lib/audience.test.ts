import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectAudience } from './audience';
import { validateSnapshot } from './product-metrics';

const at = '2026-11-01T02:30:00.000Z';
const audience = { version: 1, active30d: 3, newMonth: 0, monthFrom: '2026-10-01T03:00:00Z', activityFrom: '2026-10-02T02:30:00Z', to: at, timeZone: 'America/Sao_Paulo', activityBasis: 'authenticated_product_events' };
test('audience has a closed projection and uses the São Paulo calendar, with confirmed zero', () => {
  assert.deepEqual(projectAudience({ ...audience, email: 'private@example.invalid' }, 10, at), audience);
  for (const change of [{ newMonth: 11 }, { active30d: -1 }, { activityBasis: null }, { monthFrom: '2026-11-01T00:00:00Z' }, { activityFrom: '2026-10-03T02:30:00Z' }, { timeZone: 'UTC' }, { to: '2026-11-01T03:00:00Z' }]) {
    assert.throws(() => projectAudience({ ...audience, ...change }, 10, at));
  }
});
test('CRM preserves audience aggregates and legacy compatibility without leaking private fields', () => {
  const raw = { version: 1, product: 'members', generatedAt: at, window: { from: audience.monthFrom, to: at }, metrics: { users: 10, accounts: null, activeAccounts: null, trialAccounts: null, payingAccounts: null, complimentaryAccounts: null, canceledAccounts: null, activatedAccounts: null }, audience: { ...audience, email: 'private@example.invalid' } };
  assert.deepEqual(validateSnapshot(raw, 'members', Date.parse(at)).audience, audience);
  assert.equal(validateSnapshot({ ...raw, audience: undefined }, 'members', Date.parse(at)).audience, undefined);
  assert.throws(() => validateSnapshot({ ...raw, audience: { ...audience, newMonth: 11 } }, 'members', Date.parse(at)));
});
test('preserves Members role overlap and playback coverage without identities or cross-product reuse',()=>{
  const counts={engaged:3,creating:2,selling:1,learning:2};
  const members={rolling30d:counts,currentMonth:counts,playbackObservedFrom:'2026-10-31T12:00:00Z'};
  const out=projectAudience({...audience,members:{...members,email:'private@example.invalid'}},10,at,'members');
  assert.deepEqual(out.members,members);
  assert.throws(()=>projectAudience({...audience,members},10,at,'barberias'));
  assert.throws(()=>projectAudience({...audience,members:{...members,rolling30d:{...counts,engaged:1}}},10,at,'members'));
});
