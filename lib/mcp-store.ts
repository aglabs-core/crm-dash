import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CrmStore, McpContact, McpTask } from './mcp-server';
import type { PaymentTransaction } from './types';

// Implementação do CrmStore com a chave service_role. A chave ignora a RLS,
// então toda consulta e escrita fixa o dono da base (`user_id`), como fazem os
// fluxos do n8n. O dono vem de CRM_OWNER_USER_ID ou, sem ela, de
// crm_dono_da_base() (CRM de um único dono).

const CONTACT_COLUMNS = 'id,name,company,status,produto,origin,prospecting_pool,account_status,amount,expected_close_date,email,whatsapp,phone,created_at,updated_at';
const TASK_COLUMNS = 'id,title,description,due_date,priority,status,assigned_to,contact_id,created_at,contacts(name)';

type ContactRow = Omit<McpContact, 'has_email' | 'has_whatsapp'> & { email: string | null; whatsapp: string | null; phone: string | null };
type TaskRow = Omit<McpTask, 'contact_name'> & { contacts: { name: string | null } | { name: string | null }[] | null };

// E-mail e telefone só servem para dizer se o canal existe; não saem daqui.
const toContact = ({ email, whatsapp, phone, ...c }: ContactRow): McpContact => ({ ...c, has_email: !!email, has_whatsapp: !!(whatsapp || phone) });
const toTask = ({ contacts, ...t }: TaskRow): McpTask => ({ ...t, contact_name: (Array.isArray(contacts) ? contacts[0]?.name : contacts?.name) ?? null });

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

let cachedOwner: string | null = null;
async function ownerId(client: SupabaseClient) {
  if (cachedOwner) return cachedOwner;
  const configured = process.env.CRM_OWNER_USER_ID?.trim();
  const owner = configured || check(await client.rpc('crm_dono_da_base')) as string | null;
  if (!owner) throw new Error('dono da base não encontrado');
  cachedOwner = owner;
  return owner;
}

async function paged<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await fetchPage(from, from + 999)) ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export function supabaseCrmStore(): CrmStore | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!/^https:\/\//.test(url) || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  const owner = () => ownerId(client);

  return {
    async funnelContacts() {
      const uid = await owner();
      return paged((from, to) => client.from('contacts').select('status,prospecting_pool,created_at').eq('user_id', uid).order('id').range(from, to));
    },
    async paymentsSince(iso) {
      const uid = await owner();
      return paged<PaymentTransaction>((from, to) => client.from('payment_transactions').select('*').eq('user_id', uid).gte('paid_at', iso).order('id').range(from, to));
    },
    async pendingTasks() {
      const uid = await owner();
      const rows = await paged<TaskRow>((from, to) => client.from('tasks').select(TASK_COLUMNS).eq('user_id', uid).eq('status', 'pending').order('id').range(from, to));
      return rows.map(toTask);
    },
    async searchContacts(term, limit) {
      const uid = await owner();
      const like = `%${term}%`;
      const rows = check(await client.from('contacts').select(CONTACT_COLUMNS).eq('user_id', uid)
        .or(`name.ilike.${like},company.ilike.${like},email.ilike.${like},instagram.ilike.${like}`)
        .order('updated_at', { ascending: false, nullsFirst: false }).limit(limit)) as ContactRow[];
      return rows.map(toContact);
    },
    async contact(id) {
      const uid = await owner();
      const row = check(await client.from('contacts').select(CONTACT_COLUMNS).eq('user_id', uid).eq('id', id).maybeSingle()) as ContactRow | null;
      return row ? toContact(row) : null;
    },
    async contactActivities(id, limit) {
      const uid = await owner();
      return check(await client.from('activities').select('type,channel,content,created_at').eq('user_id', uid).eq('contact_id', id)
        .order('created_at', { ascending: false }).limit(limit)) ?? [];
    },
    async contactPayments(id) {
      const uid = await owner();
      return (check(await client.from('payment_transactions').select('*').eq('user_id', uid).eq('contact_id', id)) ?? []) as PaymentTransaction[];
    },
    async task(id) {
      const uid = await owner();
      const row = check(await client.from('tasks').select(TASK_COLUMNS).eq('user_id', uid).eq('id', id).maybeSingle()) as TaskRow | null;
      return row ? toTask(row) : null;
    },
    async insertTask(row) {
      const uid = await owner();
      const created = check(await client.from('tasks').insert([{ user_id: uid, status: 'pending', ...row }]).select(TASK_COLUMNS).single()) as TaskRow;
      return toTask(created);
    },
    async completeTask(id) {
      const uid = await owner();
      check(await client.from('tasks').update({ status: 'completed' }).eq('user_id', uid).eq('id', id).eq('status', 'pending'));
    },
    async insertActivity(row) {
      const uid = await owner();
      check(await client.from('activities').insert([{ user_id: uid, ...row }]));
    },
  };
}
