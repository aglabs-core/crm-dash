import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignAudience, inAudienceSegment, personalizePreview } from './campaign-preparation';
import type { Contact } from './types';
const row: Contact = { id: 'one', user_id: 'owner', name: null, status: 'Arquivado', produto: 'BarberPRO', email: 'one@example.invalid', prospecting_pool: true, outreach_status: 'contactable' };
test('audience keeps known aliases, isolates owners and explains exclusions', () => {
  const audience = campaignAudience([
    row, { ...row, id: 'blocked', outreach_status: 'blocked' },
    { ...row, id: 'pending', outreach_status: 'unreviewed' },
    { ...row, id: 'missing', email: null },
    { ...row, id: 'duplicate' },
    { ...row, id: 'existing', email: 'existing@example.invalid' },
    { ...row, id: 'foreign', user_id: 'other' }, { ...row, id: 'product', produto: 'Members' },
  ], 'owner', 'barberias', new Set(['existing']));
  assert.deepEqual(audience.map((r) => r.reason), ['', 'Não contatar', 'Revisão pendente', 'Sem e-mail válido', 'E-mail repetido', 'Já está na campanha']);
});
test('cold prospects and customers remain distinct from the active funnel', () => {
  assert.equal(inAudienceSegment(row, 'prospecting'), true);
  assert.equal(inAudienceSegment(row, 'pipeline'), false);
  assert.equal(inAudienceSegment({ ...row, status: 'Cliente', prospecting_pool: false }, 'clients'), true);
  assert.equal(inAudienceSegment({ ...row, status: 'Lead', prospecting_pool: false }, 'pipeline'), true);
});
test('preview substitutes known tokens as plain text without inventing a name', () => {
  assert.equal(personalizePreview('{{nome}}: {{produto}} <script>literal</script>', null, 'Barberias'), 'você: Barberias <script>literal</script>');
});
