import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationsSummary } from './operations-workspace';
import type { ContactRollup } from './contact-directory';

test('cold contacts never inflate the commercial funnel; quality gaps overlap explicitly', () => {
  const row = (changes: Partial<ContactRollup>): ContactRollup => ({ total: 1, status: 'Contato', produto: 'web', ...changes });
  const totals = operationsSummary([
    row({ status: 'Arquivado', prospecting_pool: true, total: 10, produto: null, outreach_status: 'unreviewed' }),
    row({}), row({ status: 'Lead', total: 2 }), row({ status: 'Cliente' }),
    row({ status: 'Inativo' }), row({ status: 'Arquivado' }),
  ]);
  assert.deepEqual(totals, { cold: 10, qualification: 1, pipeline: 2, clients: 2, archived: 1,
    unclassified: 0, missingProduct: 10, outreachReview: 10 });
});
