'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Mail,
  Magnet,
  Trash2,
  UserPlus,
  ExternalLink,
  MessageCircle,
  Inbox,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { InstitutionalLead, LeadStatus } from '@/lib/types';
import { LEAD_STATUSES } from '@/lib/constants';
import { formatRelative } from '@/lib/format';
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
} from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

/** wa.me link from a free-form phone (assumes BR if no country code). */
function whatsappLink(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<InstitutionalLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Default to "pendentes": converted/discarded leads have left the inbox.
  const [statusFilter, setStatusFilter] = useState<'pendentes' | 'Todos' | LeadStatus>('pendentes');

  const [converting, setConverting] = useState<InstitutionalLead | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [convertForm, setConvertForm] = useState({ name: '', email: '', phone: '', company: '', produto: '' });
  const confirm = useConfirm();

  const debouncedFetch = useDebouncedCallback(() => fetchLeads(), 400);

  useEffect(() => {
    fetchLeads(true);
    const sub = supabase
      .channel('leads-inst-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads_institucional' }, debouncedFetch)
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [debouncedFetch]);

  const fetchLeads = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const { data, error } = await supabase
        .from('leads_institucional')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setLeads((data as InstitutionalLead[]) || []);
    } catch (error) {
      console.error('Error fetching leads:', error);
      toast.error('Erro ao carregar leads. Rode a migration mais recente.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (lead: InstitutionalLead, status: LeadStatus) => {
    const prev = lead.status;
    setLeads((p) => p.map((l) => (l.id === lead.id ? { ...l, status } : l)));
    const { error } = await supabase.from('leads_institucional').update({ status }).eq('id', lead.id);
    if (error) {
      setLeads((p) => p.map((l) => (l.id === lead.id ? { ...l, status: prev } : l)));
      toast.error('Erro ao atualizar status.');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Excluir lead',
      description: 'O lead será removido da captação. Esta ação não pode ser desfeita.',
      confirmText: 'Excluir',
    });
    if (!ok) return;
    const { error } = await supabase.from('leads_institucional').delete().eq('id', id);
    if (error) {
      toast.error('Erro ao excluir lead.');
      return;
    }
    setLeads((p) => p.filter((l) => l.id !== id));
    toast.success('Lead excluído.');
  };

  const openConvert = (lead: InstitutionalLead) => {
    setConverting(lead);
    setConvertForm({
      name: lead.lead || '',
      email: lead.email || '',
      phone: lead.whatsapp || '',
      company: '',
      produto: lead.produto || '',
    });
  };

  const handleConvert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!converting) return;
    try {
      setIsSubmitting(true);
      const { data: contactId, error } = await supabase.rpc('convert_institutional_lead', {
        p_lead_id: converting.id,
        p_name: convertForm.name || null,
        p_email: convertForm.email || null,
        p_phone: convertForm.phone || null,
        p_company: convertForm.company || null,
        p_product: convertForm.produto || null,
      });
      if (error || !contactId) throw error || new Error('Contact conversion returned no id');

      setLeads((p) =>
        p.map((l) =>
          l.id === converting.id ? { ...l, status: 'convertido', contact_id: contactId as string } : l,
        ),
      );
      toast.success('Lead convertido em contato!');
      setConverting(null);
    } catch (error: unknown) {
      console.error('Error converting lead:', error);
      const message = (error as { message?: string; code?: string })?.message || '';
      toast.error(message.includes('identity conflict')
        ? 'Email e telefone apontam para contatos diferentes. Revise antes de converter.'
        : (error as { code?: string })?.code === '23505'
          ? 'Outro processo atualizou esse contato. Tente converter novamente.'
          : 'Erro ao converter a entrada do site.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return leads.filter((l) => {
      const matchesSearch =
        l.lead?.toLowerCase().includes(term) ||
        (l.email?.toLowerCase().includes(term) ?? false) ||
        (l.whatsapp?.toLowerCase().includes(term) ?? false);
      const matchesStatus =
        statusFilter === 'Todos'
          ? true
          : statusFilter === 'pendentes'
            ? l.status === 'novo' || l.status === 'contatado'
            : l.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [leads, searchTerm, statusFilter]);

  const totals = useMemo(() => {
    const total = leads.length;
    const novos = leads.filter((l) => l.status === 'novo').length;
    const convertidos = leads.filter((l) => l.status === 'convertido').length;
    return {
      total,
      novos,
      convertidos,
      taxa: total ? `${((convertidos / total) * 100).toFixed(1)}%` : '—',
    };
  }, [leads]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Entradas do site</h1>
          <p className="mt-0.5 text-sm text-muted">Formulários recebidos · converta para a ficha de contato ao iniciar o atendimento</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total captados" value={totals.total} icon={Inbox} />
        <StatCard label="Novos" value={totals.novos} icon={Magnet} hint="aguardando contato" />
        <StatCard label="Convertidos" value={totals.convertidos} icon={CheckCircle2} hint="viraram contato" />
        <StatCard label="Taxa de conversão" value={totals.taxa} icon={TrendingUp} hint="convertidos / total" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted" />
            <Input
              className="pl-9"
              placeholder="Buscar por nome, email ou WhatsApp..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'pendentes' | 'Todos' | LeadStatus)}
            className="sm:w-48"
          >
            <option value="pendentes">Pendentes</option>
            <option value="Todos">Todos os status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-h-[300px] overflow-x-auto">
          {isLoading ? (
            <PageLoader />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Magnet}
              title="Nenhum lead capturado"
              description="Os leads enviados pelo formulário institucional aparecem aqui."
            />
          ) : (
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="px-6 py-3">Lead</th>
                  <th className="px-6 py-3">Contato</th>
                  <th className="px-6 py-3">Captado</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((lead) => {
                  const wa = whatsappLink(lead.whatsapp);
                  const isConverted = lead.status === 'convertido';
                  return (
                    <tr key={lead.id} className="transition-colors hover:bg-surface-2/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand">
                            {lead.lead?.split(' ').map((n) => n?.[0] || '').slice(0, 2).join('').toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-fg">{lead.lead || 'Sem nome'}</p>
                            {lead.produto && <p className="text-xs text-muted">{lead.produto}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-muted">
                          {lead.whatsapp && (
                            <a
                              href={wa ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 hover:text-emerald-500"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              {lead.whatsapp}
                            </a>
                          )}
                          {lead.email && (
                            <a href={`mailto:${lead.email}`} className="flex items-center gap-2 hover:text-brand">
                              <Mail className="h-3.5 w-3.5" />
                              {lead.email}
                            </a>
                          )}
                          {!lead.whatsapp && !lead.email && '—'}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted">{formatRelative(lead.created_at)}</td>
                      <td className="px-6 py-4">
                        <Select
                          value={lead.status}
                          onChange={(e) => updateStatus(lead, e.target.value as LeadStatus)}
                          disabled={isConverted}
                          className="h-8 w-36 py-1 text-xs"
                        >
                          {LEAD_STATUSES.map((s) => (
                            <option key={s.id} value={s.id} disabled={s.id === 'convertido' && !isConverted}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2 text-muted">
                          {isConverted && lead.contact_id ? (
                            <Link
                              href={`/contacts/${lead.contact_id}`}
                              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                              title="Ver contato"
                            >
                              <ExternalLink className="h-4 w-4" />
                              Contato
                            </Link>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => openConvert(lead)}>
                              <UserPlus className="h-4 w-4" />
                              Converter
                            </Button>
                          )}
                          <button
                            onClick={() => handleDelete(lead.id)}
                            className="transition-colors hover:text-red-500"
                            title="Excluir"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={!!converting}
        onClose={() => setConverting(null)}
        title="Converter em Contato"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConverting(null)}>
              Cancelar
            </Button>
            <Button type="submit" form="convert-form" loading={isSubmitting}>
              Criar Contato
            </Button>
          </>
        }
      >
        <form id="convert-form" onSubmit={handleConvert} className="space-y-4">
          <p className="rounded-lg bg-surface-2 p-3 text-xs text-muted">
            Cria um contato (status <Badge tone="gray">Lead</Badge>) a partir desta captação e marca o lead como{' '}
            <Badge tone="emerald">Convertido</Badge>. A partir daí você gerencia o atendimento em Contatos e Negócios.
          </p>
          <Field label="Nome" htmlFor="c-name" required>
            <Input
              id="c-name"
              required
              value={convertForm.name}
              onChange={(e) => setConvertForm({ ...convertForm, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" htmlFor="c-email">
              <Input
                id="c-email"
                type="email"
                value={convertForm.email}
                onChange={(e) => setConvertForm({ ...convertForm, email: e.target.value })}
              />
            </Field>
            <Field label="WhatsApp / Telefone" htmlFor="c-phone">
              <Input
                id="c-phone"
                value={convertForm.phone}
                onChange={(e) => setConvertForm({ ...convertForm, phone: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Empresa" htmlFor="c-company">
              <Input
                id="c-company"
                value={convertForm.company}
                onChange={(e) => setConvertForm({ ...convertForm, company: e.target.value })}
              />
            </Field>
            <Field label="Produto" htmlFor="c-produto">
              <Input
                id="c-produto"
                value={convertForm.produto}
                onChange={(e) => setConvertForm({ ...convertForm, produto: e.target.value })}
                placeholder="Ex: Consultoria"
              />
            </Field>
          </div>
        </form>
      </Modal>
    </div>
  );
}
