'use client';

import { contactName, contactInitials } from '@/lib/contact-name';
import { productLabel } from '@/lib/product-label';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  ExternalLink,
  DollarSign,
  Briefcase,
  CheckSquare,
  Clock,
  Users,
  AtSign,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { Contact, Task, Activity, ActivityType } from '@/lib/types';
import {
  statusTone,
  statusLabel,
  priorityTone,
  originTone,
  originLabel,
  isClientStatus,
  isActiveStatus,
} from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/format';
import { assigneeLabel } from '@/lib/tasks';
import { logActivity } from '@/lib/activities';
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  Button,
  StatCard,
  PageLoader,
  EmptyState,
} from '@/components/ui';
import { ActivityTimeline } from '@/components/ActivityTimeline';

export default function ContactDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [contact, setContact] = useState<Contact | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [contactRes, tasksRes, actsRes] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
        supabase.from('tasks').select('*').eq('contact_id', id).order('due_date', { ascending: true }),
        supabase.from('activities').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      ]);
      if (!active) return;
      if (!contactRes.data) setNotFound(true);
      else setContact(contactRes.data as Contact);
      setTasks((tasksRes.data as Task[]) || []);
      setActivities((actsRes.data as Activity[]) || []);
      setIsLoading(false);
    })();

    const sub = supabase
      .channel(`contact-${id}-activities`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activities', filter: `contact_id=eq.${id}` },
        (payload) => {
          const a = payload.new as Activity;
          setActivities((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev]));
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(sub);
    };
  }, [id]);

  const handleLog = async (type: ActivityType, content: string) => {
    const created = await logActivity({ contact_id: id, type, content });
    if (created) {
      setActivities((prev) => (prev.some((x) => x.id === created.id) ? prev : [created, ...prev]));
    }
  };

  const promoteToLead = async () => {
    setIsPromoting(true);
    const { data, error } = await supabase.from('contacts')
      .update({ status: 'Lead', prospecting_pool: false }).eq('id', id).select().single();
    if (error) toast.error('Não foi possível mover para Lead.');
    else {
      setContact(data as Contact);
      toast.success('Contato movido para Lead.');
    }
    setIsPromoting(false);
  };

  if (isLoading) return <PageLoader />;

  if (notFound || !contact) {
    return (
      <EmptyState
        icon={Users}
        title="Contato não encontrado"
        description="O contato pode ter sido removido."
        action={
          <Link href="/contacts">
            <Button variant="secondary">Voltar para Contatos</Button>
          </Link>
        }
      />
    );
  }

  const amount = Number(contact.amount) || 0;
  const isClient = isClientStatus(contact.status);
  const isActive = isActiveStatus(contact.status);
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const initials = contactInitials(contact.name);

  return (
    <div className="space-y-6">
      <Link href="/contacts" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" />
        Contatos
      </Link>

      {/* Header */}
      <Card className="p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand/10 text-lg font-bold text-brand">
              {initials}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-fg">{contactName(contact.name)}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {contact.prospecting_pool
                  ? <Badge tone="purple">Prospecção</Badge>
                  : <Badge tone={statusTone(contact.status)}>{statusLabel(contact.status)}</Badge>}
                {(contact.prospecting_pool || contact.outreach_status === 'blocked') && (
                  <Badge tone={contact.outreach_status === 'blocked' ? 'red' : contact.outreach_status === 'contactable' ? 'emerald' : 'gray'}>
                    {contact.outreach_status === 'blocked' ? 'Não contatar' : contact.outreach_status === 'contactable' ? 'Apto para contato' : 'Revisão pendente'}
                  </Badge>
                )}
                <Badge tone={originTone(contact.origin)}>{originLabel(contact.origin)}</Badge>
                {contact.produto && <Badge tone="purple">{productLabel(contact.produto)}</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                {contact.company && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-4 w-4" />
                    {contact.company}
                  </span>
                )}
                {contact.instagram && (
                  <a href={`https://instagram.com/${contact.instagram}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
                    <AtSign className="h-4 w-4" />
                    {contact.instagram}
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 hover:text-fg">
                    <Mail className="h-4 w-4" />
                    {contact.email}
                  </a>
                )}
                {contact.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-4 w-4" />
                    {contact.phone}
                  </span>
                )}
                {contact.lp_url && !contact.prospecting_pool && (
                  <a
                    href={contact.lp_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Landing Page
                  </a>
                )}
              </div>
            </div>
          </div>
          {contact.prospecting_pool ? (
            <Button onClick={promoteToLead} loading={isPromoting}>Houve interesse · mover para Lead</Button>
          ) : (
            <Link href="/deals"><Button variant="secondary"><Briefcase className="h-4 w-4" />Abrir no Funil</Button></Link>
          )}
        </div>
      </Card>

      {/* Rollups */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={contact.prospecting_pool ? 'Valor histórico estimado' : 'Valor do Negócio'} value={formatCurrency(amount)} icon={DollarSign} />
        <StatCard label="Etapa" value={contact.prospecting_pool ? 'Prospecção' : statusLabel(contact.status)} icon={Briefcase} />
        <StatCard
          label="Situação"
          value={contact.prospecting_pool ? 'Antes do Lead' : isClient ? 'Cliente' : isActive ? 'Em atendimento' : 'Arquivado'}
          icon={Users}
        />
        <StatCard label="Tarefas Pendentes" value={pendingTasks.length} icon={CheckSquare} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Linha do Tempo</CardTitle>
          </CardHeader>
          <CardBody>
            <ActivityTimeline activities={activities} onLog={handleLog} />
          </CardBody>
        </Card>

        {/* Pipeline + Tasks */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
            <CardTitle>{contact.prospecting_pool ? 'Contexto da prospecção' : 'Pipeline'}</CardTitle>
              {contact.prospecting_pool
                ? <Badge tone="purple">Prospecção</Badge>
                : <Badge tone={statusTone(contact.status)}>{statusLabel(contact.status)}</Badge>}
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">{contact.prospecting_pool ? 'Estimativa histórica' : 'Valor'}</span>
                <span className="font-semibold text-fg">{formatCurrency(amount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Prioridade</span>
                <Badge tone={priorityTone(contact.priority)}>{contact.priority || 'Média'}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Origem</span>
                <Badge tone={originTone(contact.origin)}>{originLabel(contact.origin)}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Fechamento previsto</span>
                <span className="text-fg">{contact.expected_close_date ? formatDate(contact.expected_close_date) : '—'}</span>
              </div>
              {contact.closed_at && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Fechado em</span>
                  <span className="text-fg">{formatDate(contact.closed_at)}</span>
                </div>
              )}
              {contact.status === 'Arquivado' && contact.lost_reason && (
                <p className="rounded-lg bg-surface-2 p-2 text-xs italic text-muted">{contact.lost_reason}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tarefas</CardTitle>
              <span className="text-sm text-muted">{tasks.length}</span>
            </CardHeader>
            <CardBody className="space-y-2">
              {tasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">Nenhuma tarefa.</p>
              ) : (
                tasks.map((t) => (
                  <Link
                    key={t.id}
                    href="/tasks"
                    className="flex items-center justify-between gap-2 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <p
                        className={`truncate text-sm font-medium ${
                          t.status === 'completed' ? 'text-muted line-through' : 'text-fg'
                        }`}
                      >
                        {t.title}
                      </p>
                      {t.assigned_to && <p className="text-xs text-brand">{assigneeLabel(t.assigned_to)}</p>}
                      {t.due_date && (
                        <p className="flex items-center gap-1 text-xs text-muted">
                          <Clock className="h-3 w-3" />
                          {formatDate(t.due_date)}
                        </p>
                      )}
                    </div>
                    <Badge tone={priorityTone(t.priority)}>{t.priority || 'Média'}</Badge>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
