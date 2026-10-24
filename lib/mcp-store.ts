import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CrmStore, McpContact, McpEmailRow, McpTask } from './mcp-server';
import type { PaymentTransaction } from './types';

// Implementação do CrmStore com a chave service_role.
// Leitura: o mesmo que o administrador vê no painel. As políticas "admin manage
// all" mostram a ele contatos, atividades e tarefas de todos os donos (inclusive
// os criados pela Maia, que ficam no usuário dela) e "admins read all payment
// transactions" mostra todos os pagamentos; por isso as consultas não filtram
// por user_id.
// Escrita: em nome do administrador, como faria o painel. O id vem de
// CRM_OWNER_USER_ID ou, sem ela, do único registro de admin_users.

const CONTACT_COLUMNS = 'id,name,company,status,produto,origin,prospecting_pool,account_status,amount,expected_close_date,email,whatsapp,phone,created_at,updated_at';
const TASK_COLUMNS = 'id,title,description,due_date,priority,status,assigned_to,contact_id,created_at,contacts(name,produto)';
const EMAIL_COLUMNS = 'direction,category,source_key,product,status,campaign_id,sent_at,delivered_at,opened_at,clicked_at,replied_at';

type ContactRow = Omit<McpContact, 'has_email' | 'has_whatsapp'> & { email: string | null; whatsapp: string | null; phone: string | null };
type TaskContact = { name: string | null; produto: string | null };
type TaskRow = Omit<McpTask, 'contact_name' | 'contact_product'> & { contacts: TaskContact | TaskContact[] | null };

// E-mail e telefone só servem para dizer se o canal existe; não saem daqui.
const toContact = ({ email, whatsapp, phone, ...c }: ContactRow): McpContact => ({ ...c, has_email: !!email, has_whatsapp: !!(whatsapp || phone) });
const toTask = ({ contacts, ...t }: TaskRow): McpTask => {
  const contact = Array.isArray(contacts) ? contacts[0] : contacts;
  return { ...t, contact_name: contact?.name ?? null, contact_product: contact?.produto ?? null };
};

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

let cachedOwner: string | null = null;
async function ownerId(client: SupabaseClient) {
  if (cachedOwner) return cachedOwner;
  const configured = process.env.CRM_OWNER_USER_ID?.trim();
  if (configured) return (cachedOwner = configured);
  const admins = (check(await client.from('admin_users').select('id').limit(2)) ?? []) as { id: string }[];
  if (admins.length !== 1) throw new Error('defina CRM_OWNER_USER_ID: admin_users não tem exatamente um administrador');
  return (cachedOwner = admins[0].id);
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
      return paged((from, to) => client.from('contacts').select('status,prospecting_pool,created_at,produto,account_status').order('id').range(from, to));
    },
    async paymentsSince(iso) {
      return paged<PaymentTransaction>((from, to) => client.from('payment_transactions').select('*').gte('paid_at', iso).order('id').range(from, to));
    },
    async pendingTasks() {
      const rows = await paged<TaskRow>((from, to) => client.from('tasks').select(TASK_COLUMNS).eq('status', 'pending').order('id').range(from, to));
      return rows.map(toTask);
    },
    async searchContacts(term, limit) {
      const like = `%${term}%`;
      const rows = check(await client.from('contacts').select(CONTACT_COLUMNS)
        .or(`name.ilike.${like},company.ilike.${like},email.ilike.${like},instagram.ilike.${like}`)
        .order('updated_at', { ascending: false, nullsFirst: false }).limit(limit)) as ContactRow[];
      return rows.map(toContact);
    },
    async contact(id) {
      const row = check(await client.from('contacts').select(CONTACT_COLUMNS).eq('id', id).maybeSingle()) as ContactRow | null;
      return row ? toContact(row) : null;
    },
    async contactActivities(id, limit) {
      return check(await client.from('activities').select('type,channel,content,created_at').eq('contact_id', id)
        .order('created_at', { ascending: false }).limit(limit)) ?? [];
    },
    async contactPayments(id) {
      return (check(await client.from('payment_transactions').select('*').eq('contact_id', id)) ?? []) as PaymentTransaction[];
    },
    async task(id) {
      const row = check(await client.from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle()) as TaskRow | null;
      return row ? toTask(row) : null;
    },
    async insertTask(row) {
      const uid = await owner();
      const created = check(await client.from('tasks').insert([{ user_id: uid, status: 'pending', ...row }]).select(TASK_COLUMNS).single()) as TaskRow;
      return toTask(created);
    },
    async completeTask(id) {
      check(await client.from('tasks').update({ status: 'completed' }).eq('id', id).eq('status', 'pending'));
    },
    async insertActivity(row) {
      const uid = await owner();
      check(await client.from('activities').insert([{ user_id: uid, ...row }]));
    },
    async emailMessagesSince(iso) {
      return paged<McpEmailRow>((from, to) => client.from('email_messages').select(EMAIL_COLUMNS).gte('sent_at', iso).order('id').range(from, to));
    },
  };
}
