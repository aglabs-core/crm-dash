import Link from 'next/link';
import type { Activity, Task } from '@/lib/types';
import { nextTask, latestInteraction, daysSince } from '@/lib/pipeline-context';
import { assigneeLabel } from '@/lib/tasks';
import { formatDate } from '@/lib/format';
import { accountStatusMeta, emailSourceLabel, emailStatusMeta } from '@/lib/email-ledger';
import type { PipelineEmail } from '@/lib/pipeline-data';
import { Badge } from '@/components/ui';

export function PipelineContext({ contactId, tasks, activities, available, email, accountStatus }: {
  contactId: string; tasks: Task[]; activities: Activity[]; available: boolean;
  email?: PipelineEmail; accountStatus?: string | null;
}) {
  if (!available) return <p className="mt-3 text-xs text-muted">Contexto de acompanhamento indisponível.</p>;
  const task = nextTask(tasks);
  const interaction = latestInteraction(activities);
  return <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs text-muted">
    {accountStatusMeta(accountStatus) && <Badge tone={accountStatusMeta(accountStatus)!.tone}>{accountStatusMeta(accountStatus)!.label}</Badge>}
    <p>{interaction ? `Última conversa humana: ${formatDate(interaction.created_at)} · ${daysSince(interaction.created_at)} dia(s) sem interação registrada` : 'Sem conversa humana registrada'}</p>
    <p>{email ? `Último e-mail: ${emailSourceLabel(email.source_key)} · ${emailStatusMeta(email.status).label} · ${formatDate(email.sent_at)}` : 'Sem envio de e-mail registrado nesta consulta'}</p>
    <Link href={`/contacts/${contactId}`} className="block break-words text-brand hover:underline">
      {task ? `Próxima tarefa: ${task.title}` : 'Definir tarefa manual (conferir e-mails do sistema antes de abordar)'}
    </Link>
    {task && <p>{task.due_date ? `Prazo: ${formatDate(task.due_date)}` : 'Sem prazo'} · {assigneeLabel(task.assigned_to)}</p>}
  </div>;
}
