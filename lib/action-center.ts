import type { Contact, Task } from './types';

export const ACTION_LABELS = {
  overdue: 'Tarefas vencidas',
  reply: 'Respostas recebidas',
  trial: 'Testes encerrados',
  next_step: 'Sem próximo passo',
} as const;
export type ActionKind = keyof typeof ACTION_LABELS;
export type ActionItem = { id: string; kind: ActionKind; product: string; title: string; detail: string; href: string; at: string | null };
export type ActionEmail = { id: string; contact_id: string | null; product: string | null; direction: string; category: string; status: string; sent_at: string | null; created_at: string; subject: string | null };

/** Signals for human review, never a stage change or permission to send. */
export function buildActions(contacts: Contact[], tasks: Task[], emails: ActionEmail[], now = new Date()): ActionItem[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const pending = new Set(tasks.filter((t) => t.status === 'pending' && t.contact_id).map((t) => t.contact_id));
  const actions: ActionItem[] = [];
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (const task of tasks) {
    const due = task.due_date?.slice(0, 10);
    if (task.status !== 'pending' || !due || !/^\d{4}-\d{2}-\d{2}$/.test(due) || due >= today) continue;
    const contact = task.contact_id ? byId.get(task.contact_id) : undefined;
    actions.push({ id: `task:${task.id}`, kind: 'overdue', product: contact?.produto || 'sem produto', title: task.title,
      detail: `Venceu em ${due.split('-').reverse().join('/')} · ${contact?.name || task.contacts?.name || 'Tarefa interna'}`,
      href: task.contact_id ? `/contacts/${task.contact_id}` : '/tasks', at: due });
  }
  for (const contact of contacts) {
    if (contact.prospecting_pool || ['Arquivado', 'Inativo'].includes(contact.status)) continue;
    const base = { product: contact.produto || 'sem produto', title: contact.name || contact.company || 'Contato', href: `/contacts/${contact.id}` };
    if (contact.account_status === 'trial_encerrado' && contact.status !== 'Cliente') {
      actions.push({ ...base, id: `trial:${contact.id}`, kind: 'trial', detail: 'Encerramento confirmado pelo aplicativo · revisar conta e histórico', at: contact.account_updated_at || null });
    }
    if (['Lead', 'Contatado', 'Atendimento', 'Proposta', 'Pagamento'].includes(contact.status) && !pending.has(contact.id)) {
      actions.push({ ...base, id: `next:${contact.id}`, kind: 'next_step', detail: `${contact.status} · nenhuma tarefa pendente vinculada`, at: contact.updated_at || null });
    }
  }
  // Show the latest conversational message per contact/product, ignoring automated sends.
  const latest = new Map<string, ActionEmail>();
  for (const email of emails) {
    if (!email.contact_id || ['automacao', 'transacional'].includes(email.category)) continue;
    if (email.direction === 'outbound' && !['sent', 'delivered', 'opened', 'clicked', 'replied'].includes(email.status)) continue;
    const key = `${email.contact_id}:${email.product || ''}`;
    const previous = latest.get(key);
    const timestamp = Date.parse(email.sent_at || email.created_at);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;
    if (!previous || timestamp > Date.parse(previous.sent_at || previous.created_at)) latest.set(key, email);
  }
  for (const email of latest.values()) {
    if (email.direction !== 'inbound') continue;
    const contact = byId.get(email.contact_id!);
    actions.push({ id: `reply:${email.id}`, kind: 'reply', product: email.product || contact?.produto || 'sem produto',
      title: contact?.name || 'Contato', detail: email.subject || 'Mensagem recebida · revisar conversa',
      href: `/contacts/${email.contact_id}`, at: email.sent_at || email.created_at });
  }
  const rank: Record<ActionKind, number> = { overdue: 0, reply: 1, trial: 2, next_step: 3 };
  return actions.sort((a, b) => rank[a.kind] - rank[b.kind] || (a.at || '').localeCompare(b.at || '') || a.id.localeCompare(b.id));
}
