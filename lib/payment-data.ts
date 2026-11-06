import { supabase } from './supabase';
import type { PaymentTransaction } from './types';

const FIELDS = 'id, contact_id, gateway, external_id, status, product, currency, amount, refunded_amount, net_amount, paid_at';
const PAGE_SIZE = 500;

/** Supabase caps rows per request; read every page before showing a total. */
export async function loadPaymentTransactions(options: { signal?: AbortSignal } = {}, client = supabase): Promise<PaymentTransaction[]> {
  const payments: PaymentTransaction[] = [];
  for (let offset = 0; ; offset = payments.length) {
    let query = client.from('payment_transactions')
      .select(FIELDS)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return payments;
    payments.push(...(data as PaymentTransaction[] ?? []));
  }
}
