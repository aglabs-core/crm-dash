import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAsaasPayment } from '../integrations/n8n/asaas-payment.js';
const event = { external_id: 'synthetic', event: 'PAYMENT_RECEIVED' };
test('Asaas full refund is zero net even without the optional refunds array', () => {
  const row = mapAsaasPayment({ value:17,status:'REFUNDED' },{...event,event:'PAYMENT_REFUNDED'},{});
  assert.equal(row.status,'refunded'); assert.equal(row.refunded_amount,17);
});
test('Asaas partial refund sums only completed refunds and never counts fees as gross', () => {
  const row = mapAsaasPayment({value:17,netValue:15,status:'RECEIVED',refunds:[{status:'DONE',value:5},{status:'PENDING',value:2},{status:'CANCELLED',value:3}]},{...event,event:'PAYMENT_PARTIALLY_REFUNDED'},{});
  assert.equal(row.status,'partially_refunded'); assert.equal(row.valor,17); assert.equal(row.refunded_amount,5);
});
test('Asaas pending or inconsistent refund cannot silently become a paid replay', () => {
  assert.throws(()=>mapAsaasPayment({value:17,status:'REFUND_REQUESTED'},event,{}));
  assert.throws(()=>mapAsaasPayment({value:17,status:'RECEIVED'},{...event,event:'PAYMENT_REFUNDED'},{}));
  assert.throws(()=>mapAsaasPayment({value:17,status:'RECEIVED',refunds:[{status:'DONE',value:20}]},event,{}));
});
