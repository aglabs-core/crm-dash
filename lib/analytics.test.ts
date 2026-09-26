import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildClients, monthlySeries, salesContacts, winRate } from './analytics';
import type { Contact, PaymentTransaction } from './types';

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

it('shows customer lifetime revenue from linked payments, including repeat purchases and refunds', () => {
  const contact: Contact = { id: 'customer', name: 'Customer', status: 'Cliente', produto: 'Legacy', amount: 999 };
  const payment = (id: string, product: string, net_amount: number): PaymentTransaction => ({
    id, contact_id: contact.id, gateway: 'asaas', external_id: id, status: net_amount ? 'paid' : 'refunded',
    product, currency: 'BRL', amount: 100, refunded_amount: 100 - net_amount, net_amount, paid_at: '2026-09-01T12:00:00Z',
  });
  const [row] = buildClients([contact], [payment('a', 'Course', 100), payment('b', 'Hosting', 70), payment('c', 'Course', 0)]);

  assert.equal(row.wonRevenue, 170);
  assert.deepEqual(row.products, ['Course', 'Hosting']);
});
