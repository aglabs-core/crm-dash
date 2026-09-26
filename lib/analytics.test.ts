import assert from 'node:assert/strict';
import { it } from 'node:test';
import { monthlySeries, salesContacts, winRate } from './analytics';
import type { Contact } from './types';

it('keeps cold outreach in contacts without counting it as lost sales or new leads', () => {
  const created_at = new Date().toISOString();
  const contacts: Contact[] = [
    { id: 'cold', name: 'Cold', status: 'Arquivado', prospecting_pool: true, created_at },
    { id: 'lost', name: 'Lost', status: 'Arquivado', prospecting_pool: false, created_at },
    { id: 'won', name: 'Won', status: 'Cliente', prospecting_pool: false, created_at },
  ];
  const funnel = salesContacts(contacts);

  assert.equal(contacts.length, 3);
  assert.equal(funnel.length, 2);
  assert.equal(winRate(funnel), 50);
  assert.equal(monthlySeries(funnel, 1)[0].newCount, 2);
});
