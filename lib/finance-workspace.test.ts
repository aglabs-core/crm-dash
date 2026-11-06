import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadPaymentTransactions } from './payment-data';
import { financeSummary, receiptMonth, paymentIssues } from './finance-workspace';
import type { PaymentTransaction } from './types';

const payment = (changes: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id: 'synthetic', contact_id: 'synthetic-contact', gateway: 'pix', external_id: 'synthetic-receipt',
  product: 'web', status: 'paid', amount: 100, refunded_amount: 0, net_amount: 100,
  currency: 'BRL', paid_at: '2026-11-01T03:00:00Z', ...changes,
});
test('receipt cohorts use São Paulo month independently of host timezone', () => {
  assert.equal(receiptMonth('2026-11-01T02:59:59Z'), '2026-10');
  assert.equal(receiptMonth('2026-11-01T03:00:00Z'), '2026-11');
  assert.equal(receiptMonth(null), null);
  assert.equal(receiptMonth('invalid'), null);
});
test('finance separates currencies, cancellations, refunds and chargebacks without floating point drift', () => {
  const summary = financeSummary([
    payment({ amount: 0.1, net_amount: 0.1 }), payment({ amount: 0.2, net_amount: 0.2 }),
    payment({ status: 'partially_refunded', refunded_amount: 30, net_amount: 70 }),
    payment({ status: 'refunded', refunded_amount: 100, net_amount: 0 }),
    payment({ status: 'chargeback' }), payment({ status: 'canceled' }), payment({ currency: 'USD' }),
  ]);
  assert.equal(summary.original, 300.3);
  assert.equal(summary.refunded, 130);
  assert.equal(summary.remaining, 70.3);
  assert.equal(summary.foreignCount, 1);
  assert.equal(summary.reviewCount, 4);
  assert.deepEqual(paymentIssues(payment()), []); // Does not assert fiscal compliance.
});
test('payment pagination survives a server cap smaller than the requested page', async () => {
  const offsets: string[] = [];
  const client = createClient('https://synthetic.example.invalid', 'synthetic', {
    auth: { persistSession: false }, global: { fetch: async (input) => {
      const offset = new URL(String(input)).searchParams.get('offset')!;
      offsets.push(offset);
      return new Response(JSON.stringify(Number(offset) < 2 ? [payment({ id: offset })] : []), { headers: { 'content-type': 'application/json' } });
    } },
  });
  assert.equal((await loadPaymentTransactions({}, client)).length, 2);
  assert.deepEqual(offsets, ['0', '1', '2']);
});
test('a payment query failure is not an empty ledger', async () => {
  const client = createClient('https://synthetic.example.invalid', 'synthetic', {
    auth: { persistSession: false }, global: { fetch: async () => new Response('{"message":"synthetic failure"}', { status: 403 }) },
  });
  await assert.rejects(loadPaymentTransactions({}, client));
});
