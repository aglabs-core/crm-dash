'use client';

import { contactNameInput, contactNamePayload, contactName, contactInitials, contactMatchesSearch } from '@/lib/contact-name';

import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Mail,
  Phone,
  Plus,
  Users,
  UserCheck,
  Headset,
  TrendingUp,
  Pencil,
  Trash2,
  ExternalLink,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Contact, ContactStatus, ContactOrigin } from '@/lib/types';
import {
  CONTACT_STATUSES,
  ORIGINS,
  statusTone,
  statusLabel,
  originTone,
  originLabel,
  isActiveStatus,
  isClientStatus,
  isArchivedStatus,
} from '@/lib/constants';
import {
  Card,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  EmptyState,
  PageLoader,
  StatCard,
  Checkbox,
} from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  company: '',
  status: 'Lead' as ContactStatus,
  origin: 'prospeccao' as ContactOrigin,
  lp_url: '',
  produto: '',
  prospecting_pool: false,
};

export default function Contacts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [productFilter, setProductFilter] = useState('Todos');
  const [situacao, setSituacao] = useState<'Todos' | 'pipeline' | 'clientes' | 'arquivados' | 'prospeccao'>('Todos');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const confirm = useConfirm();

  const openNewContactModal = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEditContactModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contactNameInput(contact.name),
      email: contact.email || '',
      phone: contact.phone || '',
      company: contact.company || '',
      status: contact.status,
      origin: (contact.origin as ContactOrigin) || 'prospeccao',
      lp_url: contact.lp_url || '',
      produto: contact.produto || '',
      prospecting_pool: !!contact.prospecting_pool,
    });
    setIsModalOpen(true);
  };

  const handleDeleteContact = async (id: string) => {
    const ok = await confirm({
      title: 'Excluir contato',
      description: 'O contato e seu histórico serão removidos. Esta ação não pode ser desfeita.',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', id);
      if (error) throw error;
      setContacts((prev) => prev.filter((c) => c.id !== id));
      toast.success('Contato excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Erro ao excluir contato.');
    }
  };

  // Debounced so a bulk update/delete (one event per row) triggers a single refetch.
  const debouncedFetch = useDebouncedCallback(() => fetchContacts(), 400);

  useEffect(() => {
    fetchContacts(true);
    const sub = supabase
      .channel('contacts-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, debouncedFetch)
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [debouncedFetch]);

  const fetchContacts = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContacts((data as Contact[]) || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const payload = {
        name: contactNamePayload(formData.name),
        email: formData.email || null,
        phone: formData.phone || null,
        company: formData.company || null,
        status: formData.status,
        origin: formData.origin,
        lp_url: formData.lp_url || null,
        produto: formData.produto || null,
        prospecting_pool: formData.prospecting_pool && formData.status === 'Arquivado',
      };

      if (editingContact) {
        const { data, error } = await supabase
          .from('contacts')
          .update(payload)
          .eq('id', editingContact.id)
          .select();
        if (error) throw error;
        if (data) {
          setContacts((prev) => prev.map((c) => (c.id === editingContact.id ? (data[0] as Contact) : c)));
          toast.success('Contato atualizado com sucesso!');
        }
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert([{ user_id: userData.user.id, ...payload }])
          .select();
        if (error) throw error;
        if (data) {
          setContacts((prev) => [data[0] as Contact, ...prev]);
          toast.success('Contato criado com sucesso!');
        }
      }
      setIsModalOpen(false);
      setEditingContact(null);
    } catch (error: unknown) {
      console.error('Error saving contact:', error);
      const code = (error as { code?: string })?.code;
      toast.error(
        code === '23505'
          ? 'Já existe um contato com esse telefone ou email.'
          : 'Erro ao salvar contato. Verifique se você está logado.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const products = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.produto?.trim()).filter((p): p is string => !!p))).sort(),
    [contacts],
  );

  // Scoped only by product — the stat cards always reflect the true split,
  // independent of the text search or the situação filter.
  const productScoped = useMemo(
    () => contacts.filter((c) => productFilter === 'Todos' || c.produto === productFilter),
    [contacts, productFilter],
  );

  const filteredContacts = useMemo(
    () =>
      productScoped.filter((contact) => {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          contactMatchesSearch(contact, term);
        const matchesSituacao =
          situacao === 'Todos'
            ? true
            : situacao === 'pipeline'
              ? isActiveStatus(contact.status)
              : situacao === 'clientes'
                ? isClientStatus(contact.status)
                : situacao === 'prospeccao'
                  ? !!contact.prospecting_pool
                  : isArchivedStatus(contact.status) && !contact.prospecting_pool;
        return matchesSearch && matchesSituacao;
      }),
    [productScoped, searchTerm, situacao],
  );

  // Honest, non-overlapping rollups so "em pipeline" (the active funnel) is clearly
  // separate from "arquivados" (out of the funnel) and "clientes" (closed).
  const totals = useMemo(() => {
    const f = productScoped;
    const total = f.length;
    const emPipeline = f.filter((c) => isActiveStatus(c.status)).length;
    const clientes = f.filter((c) => isClientStatus(c.status)).length;
    const prospeccao = f.filter((c) => c.prospecting_pool).length;
    const arquivados = f.filter((c) => isArchivedStatus(c.status) && !c.prospecting_pool).length;
    const fechados = clientes + arquivados;
    return {
      total,
      emPipeline,
      clientes,
      prospeccao,
      arquivados,
      conversao: fechados ? `${((clientes / fechados) * 100).toFixed(1)}%` : '—',
    };
  }, [productScoped]);

  const allSelected = filteredContacts.length > 0 && filteredContacts.every((c) => selected.has(c.id));
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSelectAll = () =>
    setSelected((prev) =>
      filteredContacts.every((c) => prev.has(c.id))
        ? new Set()
        : new Set(filteredContacts.map((c) => c.id)),
    );

  const bulkSetStatus = async (status: ContactStatus) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setContacts((prev) => prev.map((c) => (selected.has(c.id) ? { ...c, status, prospecting_pool: status === 'Arquivado' && c.prospecting_pool } : c)));
    setSelected(new Set());
    const { error } = await supabase.from('contacts').update({ status }).in('id', ids);
    if (error) {
      console.error('Bulk update error:', error);
      toast.error('Erro ao atualizar em massa. Rode a migration mais recente.');
      fetchContacts();
      return;
    }
    toast.success(`${ids.length} contato(s) atualizados.`);
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Excluir ${ids.length} contato(s)`,
      description: 'Os contatos e seus históricos serão removidos. Esta ação não pode ser desfeita.',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    setSelected(new Set());
    const { error } = await supabase.from('contacts').delete().in('id', ids);
    if (error) {
      toast.error('Erro ao excluir em massa.');
      fetchContacts();
      return;
    }
    setContacts((prev) => prev.filter((c) => !ids.includes(c.id)));
    toast.success(`${ids.length} contato(s) excluídos.`);
  };

  return (
    <div className="relative space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Contatos</h1>
        <Button onClick={openNewContactModal}>
          <Plus className="h-4 w-4" />
          Adicionar Contato
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total" value={totals.total} icon={Users} hint="na carteira" />
        <StatCard label="Em pipeline" value={totals.emPipeline} icon={Headset} hint="em atendimento" />
        <StatCard label="Clientes" value={totals.clientes} icon={UserCheck} hint="fecharam negócio" />
        <StatCard label="Prospecção" value={totals.prospeccao} icon={Users} hint="base para contato" />
        <StatCard label="Arquivados" value={totals.arquivados} icon={Archive} hint="fora do funil" />
        <StatCard label="Conversão" value={totals.conversao} icon={TrendingUp} hint="ganhos / fechados" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted" />
            <Input
              className="pl-9"
              placeholder="Buscar contatos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={situacao} onChange={(e) => setSituacao(e.target.value as typeof situacao)} className="sm:w-44">
            <option value="Todos">Todas as situações</option>
            <option value="pipeline">Em pipeline</option>
            <option value="clientes">Clientes</option>
            <option value="prospeccao">Prospecção</option>
            <option value="arquivados">Arquivados</option>
          </Select>
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
        </div>

        <div className="min-h-[300px] overflow-x-auto">
          {isLoading ? (
            <PageLoader />
          ) : filteredContacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nenhum contato encontrado"
              description="Ajuste a busca ou adicione um novo contato."
            />
          ) : (
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      aria-label="Selecionar todos"
                      checked={allSelected}
                      indeterminate={!allSelected && filteredContacts.some((c) => selected.has(c.id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3">Empresa</th>
                  <th className="px-6 py-3">Produto</th>
                  <th className="px-6 py-3">Contato</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className={`transition-colors hover:bg-surface-2/50 ${selected.has(contact.id) ? 'bg-brand/5' : ''}`}
                  >
                    <td className="px-4 py-4">
                      <Checkbox
                        aria-label={`Selecionar ${contactName(contact.name)}`}
                        checked={selected.has(contact.id)}
                        onChange={() => toggleSelect(contact.id)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                          {contactInitials(contact.name)}
                        </div>
                        <span className="font-medium text-fg group-hover:text-brand">{contactName(contact.name)}</span>
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-muted">{contact.company || '—'}</td>
                    <td className="px-6 py-4">
                      {contact.produto ? <Badge tone="purple">{contact.produto}</Badge> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-muted">
                        {contact.email && (
                          <span className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5" />
                            {contact.email}
                          </span>
                        )}
                        {contact.phone && (
                          <span className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5" />
                            {contact.phone}
                          </span>
                        )}
                        {!contact.email && !contact.phone && '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <Badge tone={statusTone(contact.status)}>{statusLabel(contact.status)}</Badge>
                        {contact.prospecting_pool && <Badge tone="purple">Base de prospecção</Badge>}
                        <Badge tone={originTone(contact.origin)}>{originLabel(contact.origin)}</Badge>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2 text-muted">
                        {contact.lp_url && !contact.prospecting_pool && (
                          <a
                            href={contact.lp_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="transition-colors hover:text-brand"
                            title="Abrir Landing Page"
                          >
                            <ExternalLink className="h-5 w-5" />
                          </a>
                        )}
                        <button
                          onClick={() => openEditContactModal(contact)}
                          className="transition-colors hover:text-brand"
                          title="Editar"
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteContact(contact.id)}
                          className="transition-colors hover:text-red-500"
                          title="Excluir"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Floating bulk-action bar — overlays, never shifts the table layout. */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-xl">
            <span className="text-sm font-medium text-fg">{selected.size} selecionado(s)</span>
            <Button size="sm" variant="secondary" onClick={() => bulkSetStatus('Arquivado')}>
              <Archive className="h-4 w-4" />
              Arquivar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulkSetStatus('Lead')}>
              <ArchiveRestore className="h-4 w-4" />
              Mover p/ Lead
            </Button>
            <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={bulkDelete}>
              <Trash2 className="h-4 w-4" />
              Excluir
            </Button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-muted hover:text-fg">
              Limpar
            </button>
          </div>
        </div>
      )}

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingContact ? 'Editar Contato' : 'Novo Contato'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="contact-form" loading={isSubmitting}>
              {editingContact ? 'Salvar' : 'Criar Contato'}
            </Button>
          </>
        }
      >
        <form id="contact-form" onSubmit={handleSaveContact} className="space-y-4">
          <Field label="Nome Completo" htmlFor="name" required={!editingContact}>
            <Input
              id="name"
              required={!editingContact}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex: João Silva"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="joao@exemplo.com"
              />
            </Field>
            <Field label="Telefone" htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(11) 99999-9999"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Empresa" htmlFor="company">
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Nome da Empresa"
              />
            </Field>
            <Field label="Status" htmlFor="status">
              <Select
                id="status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as ContactStatus })}
              >
                {CONTACT_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Origem" htmlFor="origin">
              <Select
                id="origin"
                value={formData.origin}
                onChange={(e) => setFormData({ ...formData, origin: e.target.value as ContactOrigin })}
              >
                {ORIGINS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Produto" htmlFor="produto">
              <Input
                id="produto"
                value={formData.produto}
                onChange={(e) => setFormData({ ...formData, produto: e.target.value })}
                placeholder="Ex: Consultoria Premium"
              />
            </Field>
            <Field label="LP URL" htmlFor="lp_url">
              <Input
                id="lp_url"
                type="url"
                value={formData.lp_url}
                onChange={(e) => setFormData({ ...formData, lp_url: e.target.value })}
                placeholder="https://exemplo.com/lp"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <Checkbox
              checked={formData.prospecting_pool}
              disabled={formData.status !== 'Arquivado'}
              onChange={(e) => setFormData({ ...formData, prospecting_pool: e.target.checked })}
            />
            Base de prospecção (fora do funil; requer status Arquivado)
          </label>
        </form>
      </Modal>
    </div>
  );
}
