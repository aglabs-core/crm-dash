import { supabase } from './supabase';
import type { PaymentTransaction } from './types';

const FIELDS = 'id, contact_id, gateway, external_id, status, product, currency, amount, refunded_amount, net_amount, paid_at';
const PAGE_SIZE = 500;

/** Supabase caps rows per request; read every page before showing a total. */
export async function loadPaymentTransactions(): Promise<PaymentTransaction[]> {
  const payments: PaymentTransaction[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('payment_transactions')
      .select(FIELDS)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    payments.push(...(data as PaymentTransaction[] ?? []));
    if (!data || data.length < PAGE_SIZE) return payments;
  }
}
