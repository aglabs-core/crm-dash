import { supabase } from './supabase';
import type { Contact } from './types';
import { KANBAN_STATUSES } from './constants';

const PAGE_SIZE = 500;

/** Read every contact page; Supabase caps a single response by default. */
export async function loadContacts(orderBy: 'created_at' | 'updated_at' = 'created_at', ascending = false,
  options: { scope?: 'pipeline' | 'clients'; signal?: AbortSignal; product?: string; columns?: string } = {}): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from('contacts')
      .select(options.columns ?? '*')
      .order(orderBy, { ascending })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (options.scope === 'pipeline') query = query.eq('prospecting_pool', false).in('status', [...KANBAN_STATUSES.map((s) => s.id), 'Arquivado']);
    if (options.scope === 'clients') query = query.in('status', ['Cliente', 'Inativo']);
    if (options.product) query = query.eq('produto', options.product);
    if (options.signal) query = query.abortSignal(options.signal);
    const { data, error } = await query;
    if (error) throw error;
    contacts.push(...(data as unknown as Contact[] ?? []));
    if (!data || data.length < PAGE_SIZE) return contacts;
  }
}
