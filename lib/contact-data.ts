import { supabase } from './supabase';
import type { Contact } from './types';
import { KANBAN_STATUSES } from './constants';
import { readAllPages } from './pagination';

const PAGE_SIZE = 500;

/** Read every contact page; Supabase caps a single response by default. */
export async function loadContacts(orderBy: 'created_at' | 'updated_at' = 'created_at', ascending = false,
  options: { scope?: 'pipeline' | 'clients'; signal?: AbortSignal; product?: string; columns?: string } = {}, client = supabase): Promise<Contact[]> {
  return readAllPages<Contact>(async (from, to) => {
    let query = client.from('contacts')
      .select(options.columns ?? '*')
      .order(orderBy, { ascending })
      .order('id', { ascending: true })
      .range(from, to);
    if (options.scope === 'pipeline') query = query.eq('prospecting_pool', false).in('status', [...KANBAN_STATUSES.map((s) => s.id), 'Arquivado']);
    if (options.scope === 'clients') query = query.in('status', ['Cliente', 'Inativo']);
    if (options.product) query = query.eq('produto', options.product);
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    return { data: data as unknown as Contact[] | null, error };
  }, PAGE_SIZE);
}
