import type { PaymentTransaction } from './types';
import { businessMonth } from './financial-calendar';

export const PAYMENT_STATUS_LABELS: Record<PaymentTransaction['status'], string> = {
  paid: 'Pago', partially_refunded: 'Devolução parcial', refunded: 'Devolvido',
  chargeback: 'Contestação', canceled: 'Cancelado',
};

/** Payment month is a cash-receipt cohort, never the fiscal service competence. */
export function receiptMonth(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return businessMonth(value);
}

export function paymentIssues(payment: PaymentTransaction): string[] {
  const issues: string[] = [];
  if (!payment.contact_id) issues.push('Vincular cliente');
  if (!payment.product?.trim()) issues.push('Identificar serviço/produto');
  if (!receiptMonth(payment.paid_at)) issues.push('Conferir data do recebimento');
  if (payment.currency !== 'BRL') issues.push('Conferir moeda separadamente');
  if (payment.status === 'chargeback') issues.push('Revisar contestação');
  if (payment.status === 'refunded' || payment.status === 'partially_refunded') issues.push('Revisar devolução e documento fiscal');
  return issues;
}

export function financeSummary(payments: PaymentTransaction[]) {
  let originalCents = 0;
  let refundCents = 0;
  let remainingCents = 0;
  for (const p of payments) {
    if (p.currency !== 'BRL' || p.status === 'canceled') continue;
    originalCents += Math.round(Number(p.amount) * 100);
    refundCents += Math.round(Number(p.refunded_amount) * 100);
    if (p.status === 'paid' || p.status === 'partially_refunded') remainingCents += Math.round(Number(p.net_amount) * 100);
  }
  return {
    original: originalCents / 100, refunded: refundCents / 100, remaining: remainingCents / 100,
    reviewCount: payments.filter((p) => paymentIssues(p).length > 0).length,
    undatedCount: payments.filter((p) => !receiptMonth(p.paid_at)).length,
    foreignCount: payments.filter((p) => p.currency !== 'BRL').length,
  };
}
