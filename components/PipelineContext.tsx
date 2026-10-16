import Link from 'next/link';
import type { Activity, Task } from '@/lib/types';
import { nextTask, latestInteraction, daysSince } from '@/lib/pipeline-context';
import { assigneeLabel } from '@/lib/tasks';
import { formatDate } from '@/lib/format';

export function PipelineContext({ contactId, tasks, activities, available }: {
  contactId: string; tasks: Task[]; activities: Activity[]; available: boolean;
}) {
  if (!available) return <p className="mt-3 text-xs text-muted">Contexto de acompanhamento indisponível.</p>;
  const task = nextTask(tasks);
  const interaction = latestInteraction(activities);
  return <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted">
    <p>{interaction ? `Última interação: ${formatDate(interaction.created_at)} · ${daysSince(interaction.created_at)} dia(s) sem interação registrada` : 'Sem interação registrada'}</p>
    <Link href={`/contacts/${contactId}`} className="block break-words text-brand hover:underline">
      {task ? `Próxima tarefa: ${task.title}` : 'Definir próxima tarefa'}
    </Link>
    {task && <p>{task.due_date ? `Prazo: ${formatDate(task.due_date)}` : 'Sem prazo'} · {assigneeLabel(task.assigned_to)}</p>}
  </div>;
}
