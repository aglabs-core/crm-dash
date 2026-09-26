import type { PaymentTransaction } from './types';

// Revenue is the net value of recorded payments. Chargebacks and canceled
// payments are excluded even if their original amount remains on the row.
export function paymentRevenue(payments: PaymentTransaction[]): number {
  return payments.reduce((sum, payment) => sum + netRevenue(payment), 0);
}

export function netRevenue(payment: PaymentTransaction): number {
  if (payment.currency !== 'BRL' || payment.status === 'canceled' || payment.status === 'chargeback') return 0;
  return Number(payment.net_amount) || 0;
}

export function paymentsByPeriod(payments: PaymentTransaction[], days: number | null): PaymentTransaction[] {
  if (!days) return payments;
  const cutoff = Date.now() - days * 86_400_000;
  return payments.filter((payment) => payment.paid_at && new Date(payment.paid_at).getTime() >= cutoff);
}

export function paymentProducts(payments: PaymentTransaction[]): { produto: string; revenue: number; count: number }[] {
  const grouped = new Map<string, { produto: string; revenue: number; count: number }>();
  for (const payment of payments) {
    const value = netRevenue(payment);
    if (!value) continue;
    const produto = payment.product?.trim() || 'Sem produto';
    const row = grouped.get(produto) ?? { produto, revenue: 0, count: 0 };
    row.revenue += value;
    row.count += 1;
    grouped.set(produto, row);
  }
  return [...grouped.values()].sort((a, b) => b.revenue - a.revenue);
}

export function paymentMonthRevenue(payments: PaymentTransaction[], year: number, month: number): number {
  return paymentRevenue(payments.filter((payment) => {
    if (!payment.paid_at) return false;
    const paid = new Date(payment.paid_at);
    return paid.getFullYear() === year && paid.getMonth() === month;
  }));
}
