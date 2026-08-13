import type { Priority, TaskAssignee } from './types';

export const TASK_ASSIGNEES: { id: TaskAssignee; label: string }[] = [
  { id: 'maia', label: 'Maia' },
  { id: 'leo', label: 'Léo' },
  { id: 'antonio', label: 'Antonio' },
  { id: 'tecnico', label: 'Responsável técnico' },
];

export type TaskFormValues = {
  title: string;
  description: string;
  due_date: string;
  priority: Priority | string;
  contact_id: string;
  assigned_to: TaskAssignee | '';
};

export function buildTaskPayload(form: TaskFormValues) {
  return {
    title: form.title,
    description: form.description || null,
    due_date: form.due_date || null,
    priority: form.priority,
    contact_id: form.contact_id || null,
    assigned_to: form.assigned_to || null,
  };
}

export function assigneeLabel(assignee: TaskAssignee | null | undefined): string {
  return TASK_ASSIGNEES.find((owner) => owner.id === assignee)?.label ?? 'Sem responsável';
}

export type AssigneeFilter = TaskAssignee | 'all' | 'unassigned';

export function taskMatchesAssignee(
  task: { assigned_to?: TaskAssignee | null },
  filter: AssigneeFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'unassigned') return !task.assigned_to;
  return task.assigned_to === filter;
}
