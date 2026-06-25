'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Mail,
  Phone,
  Plus,
  Users,
  Pencil,
  Trash2,
  DollarSign,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Contact, ContactStatus } from '@/lib/types';
import { CONTACT_STATUSES, statusTone } from '@/lib/constants';
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
} from '@/components/ui';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  company: '',
  status: 'Lead' as ContactStatus,
  lp_url: '',
  produto: '',
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col p-4">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="mt-1 text-2xl font-bold text-fg">{value}</span>
    </Card>
  );
}

export default function Contacts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [productFilter, setProductFilter] = useState('Todos');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const openNewContactModal = () => {
    setEditingContact(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEditContactModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      email: contact.email || '',
      phone: contact.phone || '',
      company: contact.company || '',
      status: contact.status,
      lp_url: contact.lp_url || '',
      produto: contact.produto || '',
    });
    setIsModalOpen(true);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este contato?')) return;
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

  useEffect(() => {
    fetchContacts(true);
    const sub = supabase
      .channel('contacts-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => fetchContacts())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

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
        name: formData.name,
        email: formData.email || null,
        phone: formData.phone || null,
        company: formData.company || null,
        status: formData.status,
        lp_url: formData.lp_url || null,
        produto: formData.produto || null,
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
    } catch (error) {
      console.error('Error saving contact:', error);
      toast.error('Erro ao salvar contato. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const products = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.produto?.trim()).filter((p): p is string => !!p))).sort(),
    [contacts],
  );

  const filteredContacts = useMemo(
    () =>
      contacts.filter((contact) => {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          contact.name.toLowerCase().includes(term) ||
          (contact.company?.toLowerCase().includes(term) ?? false);
        const matchesProduct = productFilter === 'Todos' || contact.produto === productFilter;
        return matchesSearch && matchesProduct;
      }),
    [contacts, searchTerm, productFilter],
  );

  const totals = useMemo(() => {
    const f = filteredContacts;
    return {
      total: f.length,
      leads: f.filter((c) => c.status === 'Lead').length,
      contatados: f.filter((c) => c.status === 'Contatado').length,
      negociacao: f.filter((c) => c.status === 'Negociação' || c.status === 'Proposta').length,
      clientes: f.filter((c) => c.status === 'Ganho' || c.status === 'Cliente').length,
    };
  }, [filteredContacts]);

  return (
    <div className="relative space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Contatos</h1>
        <Button onClick={openNewContactModal}>
          <Plus className="h-4 w-4" />
          Adicionar Contato
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Total" value={totals.total} />
        <Stat label="Leads" value={totals.leads} />
        <Stat label="Contatados" value={totals.contatados} />
        <Stat label="Em Negociação" value={totals.negociacao} />
        <Stat label="Clientes" value={totals.clientes} />
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
                  <tr key={contact.id} className="transition-colors hover:bg-surface-2/50">
                    <td className="px-6 py-4">
                      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                          {contact.name?.split(' ').map((n) => n?.[0] || '').slice(0, 2).join('').toUpperCase() || '?'}
                        </div>
                        <span className="font-medium text-fg group-hover:text-brand">{contact.name}</span>
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
                      <Badge tone={statusTone(contact.status)}>{contact.status}</Badge>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2 text-muted">
                        {contact.lp_url && (
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
                        <Link
                          href={`/deals?new_deal_contact_id=${contact.id}`}
                          className="transition-colors hover:text-emerald-500"
                          title="Criar Negócio"
                        >
                          <DollarSign className="h-5 w-5" />
                        </Link>
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
          <Field label="Nome Completo" htmlFor="name" required>
            <Input
              id="name"
              required
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
        </form>
      </Modal>
    </div>
  );
}
