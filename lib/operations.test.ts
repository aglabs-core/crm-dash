import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactMatchesSearch } from './contact-name';
import { toDate, formatChange } from './format';
import { buildClients, conversionFunnel, pipelineByStage } from './analytics';
import { netRevenue } from './payment-analytics';
import type { Contact, PaymentTransaction } from './types';

test('WhatsApp-only contacts are searchable by formatted and unformatted number', () => {
  const contact = { name: null, whatsapp: '+55 (11) 99999-0000', instagram: 'synthetic' };
  assert.equal(contactMatchesSearch(contact, '5511999990000'), true);
  assert.equal(contactMatchesSearch(contact, 'synthetic'), true);
});
test('SQL dates retain the local calendar day and growth from zero is undefined', () => {
  assert.equal(toDate('2026-10-17')?.getDate(), 17);
  assert.equal(formatChange(20, 0), null);
});
test('unqualified pool stays outside stage and cumulative funnel totals', () => {
  const rows: Contact[] = [{ id: 'synthetic', name: null, status: 'Lead', prospecting_pool: true }];
  assert.equal(pipelineByStage(rows)[0].count, 0);
  assert.equal(conversionFunnel(rows)[0].reached, 0);
});
test('full refunds contribute no revenue and do not imply an active customer', () => {
  const payment: PaymentTransaction = { id: 'p', contact_id: 'c', gateway: 'stripe', external_id: 'synthetic', status: 'refunded', product: null, currency: 'BRL', amount: 20, refunded_amount: 20, net_amount: 20, paid_at: null };
  assert.equal(netRevenue(payment), 0);
  const rows = buildClients([{ id: 'c', name: null, status: 'Cliente' }], [payment]);
  assert.equal(rows[0].active, false);
  assert.equal(rows[0].wonRevenue, 0);
});
