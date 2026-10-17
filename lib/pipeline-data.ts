import { supabase } from './supabase';
import { KANBAN_STATUSES } from './constants';
import type { Task, Activity } from './types';
export type PipelineSummary = { tasks: Task[]; activities: Activity[] };
type Row = { id: string; tasks: Omit<Task, 'contact_id'>[]; activities: Omit<Activity, 'contact_id'>[] };

/** Embedded limits are per parent, never a global cap across the contact list. */
export async function loadPipelineContext(signal: AbortSignal, client = supabase): Promise<PipelineSummary> {
  const summary: PipelineSummary = { tasks: [], activities: [] };
  let cursor: string | undefined;
  for (;;) {
    if (signal.aborted) throw new Error('Context request canceled');
    let query = client.from('contacts').select('id,tasks(id,title,status,due_date,assigned_to),activities(id,type,channel,created_at)')
      .in('status', KANBAN_STATUSES.map((s) => s.id)).eq('prospecting_pool', false)
      .eq('tasks.status', 'pending')
      .in('activities.type', ['followup', 'suporte', 'meeting']).neq('activities.channel', 'sistema')
      .order('due_date', { referencedTable: 'tasks', ascending: true, nullsFirst: false })
      .order('id', { referencedTable: 'tasks', ascending: true }).limit(1, { referencedTable: 'tasks' })
      .order('created_at', { referencedTable: 'activities', ascending: false })
      .order('id', { referencedTable: 'activities', ascending: true }).limit(1, { referencedTable: 'activities' })
      .order('id', { ascending: true }).range(0, 499).abortSignal(signal);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error || !data) throw new Error('Context unavailable');
    if (signal.aborted) throw new Error('Context request canceled');
    const rows = data as unknown as Row[];
    if (!rows.length) return summary;
    const last = rows[rows.length - 1].id;
    if (cursor && last <= cursor) throw new Error('Context pagination did not advance');
    for (const row of rows) {
      summary.tasks.push(...(row.tasks || []).map((t) => ({ ...t, contact_id: row.id })));
      summary.activities.push(...(row.activities || []).map((a) => ({ ...a, contact_id: row.id })));
    }
    // Continue even after a short page: the server may enforce a smaller row cap.
    cursor = last;
  }
}
