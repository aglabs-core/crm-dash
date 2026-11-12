import assert from 'node:assert/strict';
import test from 'node:test';
import type { PaymentTransaction } from './types';
import { paymentMonthRevenue, paymentProducts, paymentRevenue } from './payment-analytics';
import { receiptMonth } from './finance-workspace';

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

test('reports and finance agree on month boundaries in every browser timezone', () => {
  const previous=process.env.TZ;
  try {
    for (const timezone of ['UTC','America/Sao_Paulo','Asia/Tokyo']) {
      process.env.TZ=timezone;
      const p=payment('boundary',{paid_at:'2026-11-01T01:30:00Z'});
      assert.equal(receiptMonth(p.paid_at),'2026-10');
      assert.equal(paymentMonthRevenue([p],2026,9),100);
      assert.equal(paymentMonthRevenue([p],2026,10),0);
    }
  } finally { if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous; }
  assert.equal(paymentRevenue([payment('a',{net_amount:0.1}),payment('b',{net_amount:0.2})]),0.3);
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
