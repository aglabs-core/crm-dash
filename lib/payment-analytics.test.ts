import assert from 'node:assert/strict';
import test from 'node:test';
import type { PaymentTransaction } from './types';
import { paymentMonthRevenue, paymentProducts, paymentRevenue } from './payment-analytics';

const payment = (id: string, overrides: Partial<PaymentTransaction> = {}): PaymentTransaction => ({
  id,
  contact_id: 'one-contact',
  gateway: 'cakto',
  external_id: id,
  status: 'paid',
  product: 'LocalSite',
  currency: 'BRL',
  amount: 100,
  refunded_amount: 0,
  net_amount: 100,
  paid_at: '2026-09-12T12:00:00Z',
  ...overrides,
});

test('counts repeat purchases and refunds by payment, product, and paid month', () => {
  const payments = [
    payment('first'),
    payment('second', { status: 'partially_refunded', refunded_amount: 30, net_amount: 70 }),
    payment('old', { product: 'Outro', paid_at: '2026-08-12T12:00:00Z', net_amount: 50 }),
    payment('reversed', { status: 'chargeback', net_amount: 100 }),
  ];
  assert.equal(paymentRevenue(payments), 220);
  assert.equal(paymentMonthRevenue(payments, 2026, 8), 170);
  assert.deepEqual(paymentProducts(payments), [
    { produto: 'LocalSite', revenue: 170, count: 2 },
    { produto: 'Outro', revenue: 50, count: 1 },
  ]);
});
