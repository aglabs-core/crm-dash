import { supabase } from './supabase';
import { KANBAN_STATUSES } from './constants';
import type { Contact } from './types';

export const CONTACT_PAGE_SIZE = 50;
export type ContactRollup = Pick<Contact, 'produto' | 'origin' | 'status' | 'prospecting_pool' | 'outreach_status'> & { total: number };
export type ContactFilters = { product: string; origin: string; situation: string; outreach: string; search: string };

export async function loadContactPage(filters: ContactFilters, page: number, signal: AbortSignal, client = supabase) {
  let query = client.from('contact_directory').select('*', { count: 'exact' });
  if (filters.product === '__undefined__') query = query.is('product_key', null);
  else if (filters.product !== 'Todos') query = query.eq('product_key', filters.product);
  if (filters.origin !== 'Todos') query = query.eq('origin', filters.origin);
  switch (filters.situation) {
    case 'base': query = query.eq('status', 'Contato').eq('prospecting_pool', false); break;
    case 'pipeline': query = query.in('status', KANBAN_STATUSES.map((s) => s.id)).eq('prospecting_pool', false); break;
    case 'clientes': query = query.in('status', ['Cliente', 'Inativo']); break;
    case 'arquivados': query = query.eq('status', 'Arquivado').eq('prospecting_pool', false); break;
    case 'prospeccao':
      query = query.eq('prospecting_pool', true);
      if (filters.outreach !== 'Todos') query = query.eq('outreach_status', filters.outreach);
  }
  // Quote the PostgREST operand, escape LIKE wildcards and forbid filter syntax injection.
  const term = filters.search.trim().slice(0, 160).replace(/[\\%_*]/g, '\\$&').replace(/"/g, '\\"');
  if (term) {
    const fields = ['name', 'company', 'email', 'phone', 'whatsapp', 'instagram'];
    const clauses = fields.map((field) => `${field}.ilike."%${term}%"`);
    const digits = filters.search.replace(/\D/g, '');
    if (digits) clauses.push(`phone_digits.like.%${digits}%`, `whatsapp_digits.like.%${digits}%`);
    query = query.or(clauses.join(','));
  }
  const offset = Math.max(0, page) * CONTACT_PAGE_SIZE;
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id')
    .range(offset, offset + CONTACT_PAGE_SIZE - 1).abortSignal(signal);
  if (error) throw error;
  return { contacts: (data ?? []) as Contact[], count: count ?? 0 };
}

export async function loadContactRollups(signal: AbortSignal, client = supabase) {
  const result: ContactRollup[] = [];
  // Aggregates contain no personal data. Page until empty even with a smaller server cap.
  for (let offset = 0; ;) {
    const { data, error } = await client.from('contact_workspace_summary').select('*')
      .order('user_id').order('produto', { nullsFirst: true }).order('origin', { nullsFirst: true }).order('status')
      .order('prospecting_pool').order('outreach_status').range(offset, offset + 499).abortSignal(signal);
    if (error) throw error;
    if (!data?.length) return result;
    result.push(...data as ContactRollup[]);
    offset += data.length;
  }
}
