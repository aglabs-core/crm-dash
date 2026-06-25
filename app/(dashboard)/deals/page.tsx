'use client';

import { useState, useEffect, Suspense, useMemo } from 'react';
import {
  Plus,
  Calendar,
  GripVertical,
  Pencil,
  Trash2,
  User as UserIcon,
  DollarSign,
  Archive,
  ArchiveRestore,
  Kanban,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Deal, Contact, DealStage } from '@/lib/types';
import { DEAL_STAGES, PRIORITIES, TONE_HEX, stageTone, priorityTone } from '@/lib/constants';
import { uniqueProducts } from '@/lib/analytics';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button, Modal, Field, Input, Select, Badge, PageLoader, EmptyState } from '@/components/ui';

const DEAL_SELECT = `*, contacts ( id, name, produto )`;

const emptyForm = {
  title: '',
  company: '',
  amount: '',
  stage: 'Lead' as DealStage,
  produto: '',
  expected_close_date: '',
  priority: 'Média',
  contact_id: '',
  lost_reason: '',
};

function DealsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [productFilter, setProductFilter] = useState('Todos');
  const [view, setView] = useState<'board' | 'archived'>('board');
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const openNewDealModal = (stage: DealStage = 'Lead', contactId = '') => {
    const contact = contacts.find((c) => c.id === contactId);
    setEditingDeal(null);
    setFormData({
      ...emptyForm,
      stage,
      contact_id: contactId,
      company: contact?.company || '',
      produto: contact?.produto || '',
    });
    setIsModalOpen(true);
  };

  const openEditDealModal = (deal: Deal) => {
    setEditingDeal(deal);
    setFormData({
      title: deal.title,
      company: deal.company || '',
      amount: deal.amount ? deal.amount.toString() : '',
      stage: deal.stage,
      produto: deal.produto || '',
      expected_close_date: deal.expected_close_date ? deal.expected_close_date.split('T')[0] : '',
      priority: deal.priority || 'Média',
      contact_id: deal.contact_id || '',
      lost_reason: deal.lost_reason || '',
    });
    setIsModalOpen(true);
  };

  const handleDeleteDeal = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este negócio?')) return;
    try {
      const { error } = await supabase.from('deals').delete().eq('id', id);
      if (error) throw error;
      setDeals((prev) => prev.filter((d) => d.id !== id));
      toast.success('Negócio excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting deal:', error);
      toast.error('Erro ao excluir negócio.');
    }
  };

  const setArchived = async (deal: Deal, archived: boolean) => {
    setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, archived } : d)));
    const { error } = await supabase.from('deals').update({ archived }).eq('id', deal.id);
    if (error) {
      console.error('Error archiving deal:', error);
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? { ...d, archived: !archived } : d)));
      toast.error('Erro ao atualizar. Rode a migration mais recente.');
      return;
    }
    toast.success(archived ? 'Negócio arquivado.' : 'Negócio restaurado.');
  };

  useEffect(() => {
    setIsMounted(true);
    fetchDeals(true);
    fetchContacts();

    const sub = supabase
      .channel('deals-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => fetchDeals())
      .subscribe();

    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  useEffect(() => {
    const contactId = searchParams.get('new_deal_contact_id');
    if (contactId && contacts.length > 0) {
      openNewDealModal('Lead', contactId);
      router.replace('/deals');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, contacts, router]);

  const fetchContacts = async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, company, produto')
      .order('name', { ascending: true });
    if (error) {
      console.error('Error fetching contacts:', error);
      return;
    }
    setContacts((data as Contact[]) || []);
  };

  const fetchDeals = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const { data, error } = await supabase
        .from('deals')
        .select(DEAL_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDeals((data as Deal[]) || []);
    } catch (error) {
      console.error('Error fetching deals:', error);
      toast.error('Erro ao carregar negócios.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const payload = {
        title: formData.title,
        company: formData.company,
        amount: parseFloat(formData.amount) || 0,
        stage: formData.stage,
        produto: formData.produto || null,
        expected_close_date: formData.expected_close_date || null,
        priority: formData.priority,
        contact_id: formData.contact_id || null,
        lost_reason: formData.stage === 'Perdido' ? formData.lost_reason || null : null,
      };

      if (editingDeal) {
        const { data, error } = await supabase
          .from('deals')
          .update(payload)
          .eq('id', editingDeal.id)
          .select(DEAL_SELECT);
        if (error) throw error;
        if (data) {
          setDeals((prev) => prev.map((d) => (d.id === editingDeal.id ? (data[0] as Deal) : d)));
          toast.success('Negócio atualizado com sucesso!');
        }
      } else {
        const { data, error } = await supabase
          .from('deals')
          .insert([{ user_id: userData.user.id, ...payload }])
          .select(DEAL_SELECT);
        if (error) throw error;
        if (data) {
          setDeals((prev) => [data[0] as Deal, ...prev]);
          toast.success('Negócio criado com sucesso!');
        }
      }
      setIsModalOpen(false);
      setEditingDeal(null);
    } catch (error) {
      console.error('Error saving deal:', error);
      toast.error('Erro ao salvar negócio. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const target = deals.find((d) => d.id === draggableId);
    if (!target) return;
    const previousStage = target.stage;
    const nextStage = destination.droppableId as DealStage;

    setDeals((prev) => prev.map((d) => (d.id === draggableId ? { ...d, stage: nextStage } : d)));

    const { error } = await supabase.from('deals').update({ stage: nextStage }).eq('id', draggableId);
    if (error) {
      console.error('Error updating deal stage:', error);
      setDeals((prev) => prev.map((d) => (d.id === draggableId ? { ...d, stage: previousStage } : d)));
      toast.error('Erro ao atualizar o estágio do negócio.');
    }
  };

  const products = useMemo(() => uniqueProducts(deals), [deals]);
  const archivedDealsList = useMemo(() => deals.filter((d) => d.archived), [deals]);
  const byProduct = (d: Deal) => productFilter === 'Todos' || d.produto === productFilter;
  const filteredDeals = useMemo(
    () => deals.filter((d) => !d.archived && byProduct(d)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deals, productFilter],
  );
  const filteredArchived = useMemo(
    () => archivedDealsList.filter(byProduct),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archivedDealsList, productFilter],
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
              {archivedDealsList.length > 0 && (
                <span className="rounded-full bg-border px-1.5 text-xs text-fg">{archivedDealsList.length}</span>
              )}
            </button>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <Select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="sm:w-48"
          >
            <option value="Todos">Todos os Produtos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Button onClick={() => openNewDealModal()}>
            <Plus className="h-4 w-4" />
            Novo Negócio
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        {isLoading ? (
          <PageLoader />
        ) : view === 'archived' ? (
          filteredArchived.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Nenhum negócio arquivado"
              description="Arquive negócios parados ou perdidos para limpar o funil sem apagá-los."
            />
          ) : (
            <div className="space-y-2">
              {filteredArchived.map((deal) => (
                <div
                  key={deal.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_HEX[stageTone(deal.stage)] }} />
                      <p className="truncate text-sm font-semibold text-fg">{deal.title}</p>
                      <Badge tone={stageTone(deal.stage)}>{deal.stage}</Badge>
                      {deal.produto && <Badge tone="purple">{deal.produto}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {deal.company || '—'} · {formatCurrency(deal.amount)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setArchived(deal, false)}>
                      <ArchiveRestore className="h-4 w-4" />
                      Restaurar
                    </Button>
                    <button
                      onClick={() => handleDeleteDeal(deal.id)}
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
              {DEAL_STAGES.map((stage) => {
                const columnDeals = filteredDeals.filter((d) => d.stage === stage.id);
                const columnTotal = columnDeals.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
                return (
                  <div
                    key={stage.id}
                    className="flex max-h-full w-80 flex-col rounded-xl border border-border bg-surface-2/60"
                  >
                    <div className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-border p-4">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: TONE_HEX[stage.tone] }}
                          />
                          {stage.label}
                          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted">
                            {columnDeals.length}
                          </span>
                        </h3>
                        <p className="mt-1 text-xs font-medium text-muted">{formatCurrency(columnTotal)}</p>
                      </div>
                      <button
                        onClick={() => openNewDealModal(stage.id)}
                        className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-brand"
                        aria-label={`Novo negócio em ${stage.label}`}
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
                          {columnDeals.map((deal, index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
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
                                    <Badge tone={priorityTone(deal.priority)}>{deal.priority || 'Média'}</Badge>
                                    <div className="flex items-center gap-1 text-muted">
                                      <button
                                        onClick={() => openEditDealModal(deal)}
                                        className="opacity-0 transition-opacity hover:text-brand group-hover:opacity-100"
                                        aria-label="Editar"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => setArchived(deal, true)}
                                        className="opacity-0 transition-opacity hover:text-amber-500 group-hover:opacity-100"
                                        aria-label="Arquivar"
                                        title="Arquivar"
                                      >
                                        <Archive className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteDeal(deal.id)}
                                        className="opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                                        aria-label="Excluir"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                      <GripVertical className="ml-1 h-4 w-4 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing" />
                                    </div>
                                  </div>
                                  <h4 className="mb-1 text-sm font-semibold text-fg">{deal.title}</h4>
                                  <p className="mb-1 text-xs text-muted">{deal.company || '—'}</p>
                                  {deal.contacts && (
                                    <Link
                                      href={`/contacts/${deal.contacts.id}`}
                                      className="mb-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
                                    >
                                      <UserIcon className="h-3 w-3" />
                                      {deal.contacts.name}
                                    </Link>
                                  )}
                                  {deal.produto && (
                                    <div className="mb-2">
                                      <Badge tone="purple">{deal.produto}</Badge>
                                    </div>
                                  )}
                                  {deal.stage === 'Perdido' && deal.lost_reason && (
                                    <p className="mb-2 text-xs italic text-red-500">{deal.lost_reason}</p>
                                  )}
                                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
                                    <span className="flex items-center gap-1 font-medium text-fg">
                                      <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                                      {formatCurrency(deal.amount)}
                                    </span>
                                    {deal.expected_close_date && (
                                      <span className="flex items-center gap-1">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {formatDate(deal.expected_close_date)}
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
        title={editingDeal ? 'Editar Negócio' : 'Novo Negócio'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="deal-form" loading={isSubmitting}>
              {editingDeal ? 'Salvar' : 'Criar Negócio'}
            </Button>
          </>
        }
      >
        <form id="deal-form" onSubmit={handleSaveDeal} className="space-y-4">
          <Field label="Título do Negócio" htmlFor="title" required>
            <Input
              id="title"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Redesign de Site"
            />
          </Field>
          <Field label="Contato (Lead)" htmlFor="contact_id">
            <Select
              id="contact_id"
              value={formData.contact_id}
              onChange={(e) => {
                const contact = contacts.find((c) => c.id === e.target.value);
                setFormData((prev) => ({
                  ...prev,
                  contact_id: e.target.value,
                  company: prev.company || contact?.company || '',
                  produto: prev.produto || contact?.produto || '',
                }));
              }}
            >
              <option value="">Selecione um contato</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.company ? `(${c.company})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Empresa" htmlFor="company">
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Nome da Empresa"
              />
            </Field>
            <Field label="Produto" htmlFor="produto">
              <Input
                id="produto"
                value={formData.produto}
                onChange={(e) => setFormData({ ...formData, produto: e.target.value })}
                placeholder="Ex: Consultoria"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Valor (R$)" htmlFor="amount">
              <Input
                id="amount"
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0,00"
              />
            </Field>
            <Field label="Fechamento Esperado" htmlFor="expected_close_date">
              <Input
                id="expected_close_date"
                type="date"
                value={formData.expected_close_date}
                onChange={(e) => setFormData({ ...formData, expected_close_date: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Estágio" htmlFor="stage">
              <Select
                id="stage"
                value={formData.stage}
                onChange={(e) => setFormData({ ...formData, stage: e.target.value as DealStage })}
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridade" htmlFor="priority">
              <Select
                id="priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {formData.stage === 'Perdido' && (
            <Field label="Motivo da Perda" htmlFor="lost_reason" hint="Por que o negócio foi perdido?">
              <Input
                id="lost_reason"
                value={formData.lost_reason}
                onChange={(e) => setFormData({ ...formData, lost_reason: e.target.value })}
                placeholder="Ex: Preço acima do orçamento"
              />
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
      <DealsContent />
    </Suspense>
  );
}
