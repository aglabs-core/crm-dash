'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, UserCheck, DollarSign, Briefcase, Trophy, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Contact, Deal } from '@/lib/types';
import { buildClients } from '@/lib/analytics';
import { formatCurrency, formatRelative } from '@/lib/format';
import { Card, Badge, Input, Select, EmptyState, PageLoader, StatCard } from '@/components/ui';

export default function ClientsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [productFilter, setProductFilter] = useState('Todos');

  useEffect(() => {
    fetchData(true);
    const sub = supabase
      .channel('clients-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => fetchData())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  const fetchData = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const [contactsRes, dealsRes] = await Promise.all([
        supabase.from('contacts').select('*'),
        supabase.from('deals').select('*'),
      ]);
      setContacts((contactsRes.data as Contact[]) || []);
      setDeals((dealsRes.data as Deal[]) || []);
    } catch (error) {
      console.error('Error fetching clients:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clients = useMemo(() => buildClients(contacts, deals), [contacts, deals]);

  const products = useMemo(
    () => Array.from(new Set(clients.flatMap((c) => c.products))).sort(),
    [clients],
  );

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return clients.filter((c) => {
      const matchesSearch =
        c.contact.name.toLowerCase().includes(term) ||
        (c.contact.company?.toLowerCase().includes(term) ?? false);
      const matchesProduct = productFilter === 'Todos' || c.products.includes(productFilter);
      return matchesSearch && matchesProduct;
    });
  }, [clients, searchTerm, productFilter]);

  const totals = useMemo(() => {
    const revenue = clients.reduce((s, c) => s + c.wonRevenue, 0);
    const wonDeals = clients.reduce((s, c) => s + c.wonCount, 0);
    const now = new Date();
    const newThisMonth = clients.filter(
      (c) =>
        c.lastWonAt &&
        new Date(c.lastWonAt).getMonth() === now.getMonth() &&
        new Date(c.lastWonAt).getFullYear() === now.getFullYear(),
    ).length;
    return {
      count: clients.length,
      revenue,
      ticket: wonDeals ? revenue / wonDeals : 0,
      newThisMonth,
    };
  }, [clients]);

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg">Clientes</h1>
        <p className="mt-0.5 text-sm text-muted">Contatos que fecharam negócio · carteira ativa</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Clientes" value={totals.count} icon={UserCheck} />
        <StatCard label="Receita total" value={formatCurrency(totals.revenue)} icon={DollarSign} hint="negócios ganhos" />
        <StatCard label="Ticket médio" value={formatCurrency(totals.ticket)} icon={Trophy} hint="por negócio ganho" />
        <StatCard label="Fecharam no mês" value={totals.newThisMonth} icon={Briefcase} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted" />
            <Input
              className="pl-9"
              placeholder="Buscar clientes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="sm:w-48">
            <option value="Todos">Todos os Produtos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-h-[300px] overflow-x-auto">
          {filtered.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="Nenhum cliente ainda"
              description="Quando um negócio for marcado como Ganho, o contato aparece aqui."
            />
          ) : (
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-surface-2/60">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Produtos</th>
                  <th className="px-6 py-3 text-right">Ganhos</th>
                  <th className="px-6 py-3 text-right">Receita</th>
                  <th className="px-6 py-3 text-right">Em aberto</th>
                  <th className="px-6 py-3">Último fechamento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(({ contact, products: prods, wonCount, wonRevenue, openValue, lastWonAt }) => (
                  <tr key={contact.id} className="transition-colors hover:bg-surface-2/50">
                    <td className="px-6 py-4">
                      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 group">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {contact.name?.split(' ').map((n) => n?.[0] || '').slice(0, 2).join('').toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-fg group-hover:text-brand">{contact.name}</p>
                          {contact.company && (
                            <p className="flex items-center gap-1 text-xs text-muted">
                              <Building2 className="h-3 w-3" />
                              {contact.company}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {prods.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          prods.map((p) => (
                            <Badge key={p} tone="purple">
                              {p}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-fg">{wonCount}</td>
                    <td className="px-6 py-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(wonRevenue)}
                    </td>
                    <td className="px-6 py-4 text-right text-muted">
                      {openValue > 0 ? formatCurrency(openValue) : '—'}
                    </td>
                    <td className="px-6 py-4 text-muted">{lastWonAt ? formatRelative(lastWonAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
