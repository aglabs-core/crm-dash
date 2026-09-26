'use client';

import { contactNameInput, contactNamePayload, contactName } from '@/lib/contact-name';

import { useState, useEffect, Suspense, useMemo } from 'react';
import {
  Plus,
  Calendar,
  GripVertical,
  Pencil,
  Trash2,
  DollarSign,
  Archive,
  ArchiveRestore,
  Trophy,
  Kanban,
  Building2,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Contact, ContactStatus, ContactOrigin } from '@/lib/types';
import {
  KANBAN_STATUSES,
  CONTACT_STATUSES,
  PRIORITIES,
  ORIGINS,
  TONE_HEX,
  statusTone,
  priorityTone,
  originTone,
  originLabel,
} from '@/lib/constants';
import { uniqueProducts } from '@/lib/analytics';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button, Modal, Field, Input, Select, Badge, PageLoader, EmptyState } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

const emptyForm = {
  name: '',
  company: '',
  email: '',
  phone: '',
  produto: '',
  amount: '',
  expected_close_date: '',
  priority: 'Média',
  origin: 'prospeccao' as ContactOrigin,
  status: 'Lead' as ContactStatus,
  lost_reason: '',
};

function PipelineContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [productFilter, setProductFilter] = useState('Todos');
  const [view, setView] = useState<'board' | 'archived'>('board');
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const confirm = useConfirm();

  const openNew = (status: ContactStatus = 'Lead') => {
    setEditing(null);
    setFormData({ ...emptyForm, status });
    setIsModalOpen(true);
  };

  const openEdit = (c: Contact) => {
    setEditing(c);
    setFormData({
      name: contactNameInput(c.name),
      company: c.company || '',
      email: c.email || '',
      phone: c.phone || '',
      produto: c.produto || '',
      amount: c.amount ? String(c.amount) : '',
      expected_close_date: c.expected_close_date ? c.expected_close_date.split('T')[0] : '',
      priority: c.priority || 'Média',
      origin: (c.origin as ContactOrigin) || 'prospeccao',
      status: c.status,
      lost_reason: c.lost_reason || '',
    });
    setIsModalOpen(true);
  };

  // Debounced so drag-and-drop bursts / bulk changes refetch once, not per event.
  const debouncedFetch = useDebouncedCallback(() => fetchContacts(), 400);

  useEffect(() => {
    setIsMounted(true);
    fetchContacts(true);
    const sub = supabase
      .channel('pipeline-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, debouncedFetch)
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [debouncedFetch]);

  useEffect(() => {
    if (searchParams.get('new')) {
      openNew('Lead');
      router.replace('/deals');
    }
  }, [searchParams, router]);

  const fetchContacts = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setContacts((data as Contact[]) || []);
    } catch (error) {
      console.error('Error fetching pipeline:', error);
      toast.error('Erro ao carregar o funil.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Excluir contato',
      description: 'O contato e seu histórico serão removidos. Esta ação não pode ser desfeita.',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir.');
      return;
    }
    setContacts((prev) => prev.filter((c) => c.id !== id));
    toast.success('Contato excluído.');
  };

  const setStatus = async (c: Contact, status: ContactStatus, msg: string) => {
    const prev = c.status;
    setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, status } : x)));
    const { error } = await supabase.from('contacts').update({ status }).eq('id', c.id);
    if (error) {
      setContacts((p) => p.map((x) => (x.id === c.id ? { ...x, status: prev } : x)));
      toast.error('Erro ao atualizar. Rode a migration mais recente.');
      return;
    }
    toast.success(msg);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const payload = {
        name: contactNamePayload(formData.name),
        company: formData.company || null,
        email: formData.email || null,
        phone: formData.phone || null,
        produto: formData.produto || null,
        amount: parseFloat(formData.amount) || 0,
        expected_close_date: formData.expected_close_date || null,
        priority: formData.priority,
        origin: formData.origin,
        status: formData.status,
        lost_reason: formData.status === 'Arquivado' ? formData.lost_reason || null : null,
      };

      if (editing) {
        const { data, error } = await supabase.from('contacts').update(payload).eq('id', editing.id).select();
        if (error) throw error;
        if (data) setContacts((p) => p.map((c) => (c.id === editing.id ? (data[0] as Contact) : c)));
        toast.success('Contato atualizado.');
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert([{ user_id: userData.user.id, ...payload }])
          .select();
        if (error) throw error;
        if (data) setContacts((p) => [data[0] as Contact, ...p]);
        toast.success('Contato criado.');
      }
      setIsModalOpen(false);
      setEditing(null);
    } catch (error: unknown) {
      console.error('Error saving contact:', error);
      const code = (error as { code?: string })?.code;
      toast.error(code === '23505' ? 'Já existe um contato com esse telefone ou email.' : 'Erro ao salvar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const target = contacts.find((c) => c.id === draggableId);
    if (!target) return;
    const previous = target.status;
    const next = destination.droppableId as ContactStatus;

    setContacts((prev) => prev.map((c) => (c.id === draggableId ? { ...c, status: next } : c)));
    const { error } = await supabase.from('contacts').update({ status: next }).eq('id', draggableId);
    if (error) {
      setContacts((prev) => prev.map((c) => (c.id === draggableId ? { ...c, status: previous } : c)));
      toast.error('Erro ao mover o contato.');
    }
  };

  const products = useMemo(() => uniqueProducts(contacts), [contacts]);
  const byProduct = (c: Contact) => productFilter === 'Todos' || c.produto === productFilter;
  const archivedList = useMemo(
    () => contacts.filter((c) => c.status === 'Arquivado' && !c.prospecting_pool && byProduct(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, productFilter],
  );

  if (!isMounted) return null; // avoid dnd hydration mismatch

  return (
    <div className="relative flex h-full flex-col space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-fg">Funil de Vendas</h1>
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-sm">
            <button
              onClick={() => setView('board')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors',
                view === 'board' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              <Kanban className="h-4 w-4" />
              Funil
            </button>
            <button
              onClick={() => setView('archived')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors',
                view === 'archived' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              <Archive className="h-4 w-4" />
              Arquivados
              {archivedList.length > 0 && (
                <span className="rounded-full bg-border px-1.5 text-xs text-fg">{archivedList.length}</span>
              )}
            </button>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="sm:w-48">
            <option value="Todos">Todos os Produtos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Button onClick={() => openNew()}>
            <Plus className="h-4 w-4" />
            Novo Lead
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        {isLoading ? (
          <PageLoader />
        ) : view === 'archived' ? (
          archivedList.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Nenhum contato arquivado"
              description="Arquive contatos que não fecharam para limpar o funil sem perdê-los."
            />
          ) : (
            <div className="space-y-2">
              {archivedList.map((c) => (
                <div key={c.id} className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-fg">{contactName(c.name)}</p>
                      {c.produto && <Badge tone="purple">{c.produto}</Badge>}
                      <Badge tone={originTone(c.origin)}>{originLabel(c.origin)}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {c.company || '—'} · {formatCurrency(c.amount)}
                      {c.lost_reason ? ` · ${c.lost_reason}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setStatus(c, 'Lead', 'Contato restaurado.')}>
                      <ArchiveRestore className="h-4 w-4" />
                      Restaurar
                    </Button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-1 text-muted transition-colors hover:text-red-500"
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex h-full min-w-max items-start gap-5">
              {KANBAN_STATUSES.map((stage) => {
                const columnContacts = contacts.filter((c) => c.status === stage.id && byProduct(c));
                const columnTotal = columnContacts.reduce((acc, c) => acc + (Number(c.amount) || 0), 0);
                return (
                  <div
                    key={stage.id}
                    className="flex max-h-full w-80 flex-col rounded-xl border border-border bg-surface-2/60"
                  >
                    <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-border p-4">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE_HEX[stage.tone] }} />
                          {stage.label}
                          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                            {columnContacts.length}
                          </span>
                        </h3>
                        <p className="mt-1 text-xs font-medium text-muted">{formatCurrency(columnTotal)}</p>
                      </div>
                      <button
                        onClick={() => openNew(stage.id)}
                        className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-brand"
                        aria-label={`Novo em ${stage.label}`}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>

                    <Droppable droppableId={stage.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`min-h-[150px] flex-1 space-y-3 overflow-y-auto p-3 transition-colors ${
                            snapshot.isDraggingOver ? 'bg-brand/5' : ''
                          }`}
                        >
                          {columnContacts.map((c, index) => (
                            <Draggable key={c.id} draggableId={c.id} index={index}>
                              {(prov, snap) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  className={`group rounded-lg border bg-surface p-4 transition-all ${
                                    snap.isDragging
                                      ? 'rotate-1 border-brand shadow-lg'
                                      : 'border-border shadow-sm hover:border-brand/40 hover:shadow-md'
                                  }`}
                                >
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <Badge tone={priorityTone(c.priority)}>{c.priority || 'Média'}</Badge>
                                      <Badge tone={originTone(c.origin)}>{originLabel(c.origin)}</Badge>
                                    </div>
                                    <div className="flex items-center gap-1 text-muted">
                                      <button
                                        onClick={() => setStatus(c, 'Cliente', 'Ganho! Virou cliente. 🎉')}
                                        className="opacity-0 transition-opacity hover:text-emerald-500 group-hover:opacity-100"
                                        aria-label="Marcar como cliente"
                                        title="Ganhou (vira Cliente)"
                                      >
                                        <Trophy className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => openEdit(c)}
                                        className="opacity-0 transition-opacity hover:text-brand group-hover:opacity-100"
                                        aria-label="Editar"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => setStatus(c, 'Arquivado', 'Contato arquivado.')}
                                        className="opacity-0 transition-opacity hover:text-amber-500 group-hover:opacity-100"
                                        aria-label="Arquivar"
                                        title="Arquivar (não fechou)"
                                      >
                                        <Archive className="h-4 w-4" />
                                      </button>
                                      <GripVertical className="ml-1 h-4 w-4 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing" />
                                    </div>
                                  </div>
                                  <Link
                                    href={`/contacts/${c.id}`}
                                    className="mb-1 block text-sm font-semibold text-fg hover:text-brand"
                                  >
                                    {contactName(c.name)}
                                  </Link>
                                  {c.company && (
                                    <p className="mb-1 flex items-center gap-1 text-xs text-muted">
                                      <Building2 className="h-3 w-3" />
                                      {c.company}
                                    </p>
                                  )}
                                  {c.produto && (
                                    <div className="mb-2">
                                      <Badge tone="purple">{c.produto}</Badge>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
                                    <span className="flex items-center gap-1 font-medium text-fg">
                                      <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                                      {formatCurrency(c.amount)}
                                    </span>
                                    {c.expected_close_date && (
                                      <span className="flex items-center gap-1">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {formatDate(c.expected_close_date)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </div>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'Editar Contato' : 'Novo Lead'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="pipeline-form" loading={isSubmitting}>
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </>
        }
      >
        <form id="pipeline-form" onSubmit={handleSave} className="space-y-4">
          <Field label="Nome" htmlFor="name" required={!editing}>
            <Input
              id="name"
              required={!editing}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: João Silva"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="WhatsApp / Telefone" htmlFor="phone">
              <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Empresa" htmlFor="company">
              <Input id="company" value={formData.company} onChange={(e) => setFormData({ ...formData, company: e.target.value })} />
            </Field>
            <Field label="Produto" htmlFor="produto">
              <Input id="produto" value={formData.produto} onChange={(e) => setFormData({ ...formData, produto: e.target.value })} placeholder="Ex: Consultoria" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor (R$)" htmlFor="amount">
              <Input id="amount" type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} placeholder="0,00" />
            </Field>
            <Field label="Fechamento Esperado" htmlFor="expected_close_date">
              <Input id="expected_close_date" type="date" value={formData.expected_close_date} onChange={(e) => setFormData({ ...formData, expected_close_date: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Etapa" htmlFor="status">
              <Select id="status" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as ContactStatus })}>
                {CONTACT_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridade" htmlFor="priority">
              <Select id="priority" value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })}>
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Origem" htmlFor="origin">
              <Select id="origin" value={formData.origin} onChange={(e) => setFormData({ ...formData, origin: e.target.value as ContactOrigin })}>
                {ORIGINS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {formData.status === 'Arquivado' && (
            <Field label="Motivo (não fechou)" htmlFor="lost_reason" hint="Por que não avançou?">
              <Input id="lost_reason" value={formData.lost_reason} onChange={(e) => setFormData({ ...formData, lost_reason: e.target.value })} placeholder="Ex: Preço acima do orçamento" />
            </Field>
          )}
        </form>
      </Modal>
    </div>
  );
}

export default function Deals() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PipelineContent />
    </Suspense>
  );
}
