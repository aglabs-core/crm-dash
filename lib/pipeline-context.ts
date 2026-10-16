import type { Activity, Task } from './types';

export function nextTask(tasks: Task[]): Task | undefined {
  return tasks.filter((t) => t.status === 'pending').sort((a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.id.localeCompare(b.id))[0];
}

/** System events, notes and sends do not prove a conversation occurred. */
export function latestInteraction(activities: Activity[]): Activity | undefined {
  return activities.filter((a) => ['followup', 'suporte', 'meeting'].includes(a.type)
    && !!a.channel && a.channel !== 'sistema' && Number.isFinite(Date.parse(a.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

export function daysSince(timestamp: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 86400000));
}

export function byContact<T extends { contact_id?: string | null }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.contact_id) continue;
    const list = result.get(row.contact_id) || [];
    list.push(row);
    result.set(row.contact_id, list);
  }
  return result;
}
