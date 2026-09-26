import { supabase } from './supabase';
import type { Contact } from './types';

const PAGE_SIZE = 500;

/** Read every contact page; Supabase caps a single response by default. */
export async function loadContacts(orderBy: 'created_at' | 'updated_at' = 'created_at', ascending = false): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('contacts')
      .select('*')
      .order(orderBy, { ascending })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    contacts.push(...(data as Contact[] ?? []));
    if (!data || data.length < PAGE_SIZE) return contacts;
  }
}
