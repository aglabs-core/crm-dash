'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ACTION_LABELS, buildActions, type ActionEmail, type ActionItem, type ActionKind } from '@/lib/action-center';
import type { Contact, Task } from '@/lib/types';
import { productLabel } from '@/lib/product-label';
import { Button, Select, PageLoader } from '@/components/ui';

async function readPages<T>(table: string, columns: string, signal: AbortSignal) {
  const rows: T[] = [];
  for (let offset = 0; offset < 5000; offset = rows.length) {
    let query = supabase.from(table).select(columns).order('created_at', { ascending: false }).order('id').range(offset, offset + 499).abortSignal(signal);
    if (table === 'tasks') query = query.eq('status', 'pending');
    if (table === 'email_messages') query = query.not('category', 'in', '(automacao,transacional)');
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (!data.length) return { rows, limited: false };
  }
  return { rows, limited: true };
}
export default function ActionsPage() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [product, setProduct] = useState('all');
  const [kind, setKind] = useState<ActionKind | 'all'>('all');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [limited, setLimited] = useState(false);
  const [tasksComplete, setTasksComplete] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) throw new Error('session unavailable');
      return Promise.all([
      readPages<Contact>('contacts', 'id,name,company,produto,status,prospecting_pool,account_status,account_updated_at,updated_at', controller.signal),
      readPages<Task>('tasks', 'id,title,contact_id,due_date,status', controller.signal),
      readPages<ActionEmail>('email_messages', 'id,contact_id,product,direction,category,status,sent_at,created_at,subject', controller.signal),
      ]);
    }).then(([contacts, tasks, emails]) => {
      if (controller.signal.aborted) return;
      // Absence of a task is only meaningful when the task query is complete.
      setItems(buildActions(contacts.rows, tasks.rows, emails.rows).filter((item) => !tasks.limited || item.kind !== 'next_step'));
      setLimited(contacts.limited || tasks.limited || emails.limited); setCheckedAt(new Date()); setPage(0);
      setTasksComplete(!tasks.limited);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);
  const products = useMemo(() => [...new Set(items.map((item) => item.product))].sort(), [items]);
  const scoped = items.filter((item) => product === 'all' || item.product === product);
  const visible = scoped.filter((item) => kind === 'all' || item.kind === kind);
  return <div className="mx-auto max-w-6xl space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Central de ações</h1><p className="mt-1 text-sm text-muted">O próximo passo de cada produto, com acesso ao histórico do contato.</p></div><Button variant="secondary" size="sm" disabled={loading} onClick={() => { setLoading(true); setError(false); setVersion((v) => v + 1); }}><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button></header>
    {loading ? <PageLoader /> : error ? <div role="alert" className="rounded-xl border border-border p-5 text-sm">Não foi possível consultar todas as fontes. Atualize para tentar novamente ou <Link href="/login" className="text-brand underline">entre no CRM</Link> se sua sessão expirou.</div> : <>
      {limited && <p role="status" className="text-sm text-muted">Visão parcial: até 5.000 registros recentes por fonte. A indicação de próximo passo fica oculta quando a consulta de tarefas está incompleta.</p>}
      <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">Produto <Select value={product} onChange={(e) => { setProduct(e.target.value); setPage(0); }}><option value="all">Todos os produtos</option>{products.map((p) => <option key={p} value={p}>{productLabel(p)}</option>)}</Select></label><span className="text-xs text-muted">{checkedAt && `Consultado às ${checkedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}</span></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(ACTION_LABELS).map(([key, label]) => <button key={key} disabled={key === 'next_step' && !tasksComplete} aria-pressed={kind === key} onClick={() => { setKind(kind === key ? 'all' : key as ActionKind); setPage(0); }} className={`rounded-xl border p-3 text-left disabled:opacity-50 ${kind === key ? 'border-brand bg-brand/10' : 'border-border bg-surface hover:bg-surface-2'}`}><span className="block text-xs text-muted">{label}</span><span className="mt-1 block text-xl font-semibold tabular-nums">{key === 'next_step' && !tasksComplete ? '—' : scoped.filter((item) => item.kind === key).length}</span></button>)}</div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface"><div className="border-b border-border px-4 py-3 text-sm font-medium">{kind === 'all' ? 'Todas as ações' : ACTION_LABELS[kind]} <span className="text-muted">· {visible.length}</span></div>
        {!visible.length ? <p className="p-5 text-sm text-muted">Nenhuma ação encontrada com estes filtros.</p> : <ul className="divide-y divide-border">{visible.slice(page * 25, page * 25 + 25).map((item) => <li key={item.id}><Link href={item.href} className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-surface-2"><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap gap-x-2 text-xs text-muted"><span className="text-brand">{productLabel(item.product)}</span><span>{ACTION_LABELS[item.kind]}</span></div><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-0.5 break-words text-xs text-muted">{item.detail}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-muted" /></Link></li>)}</ul>}
        {visible.length > 25 && <div className="flex items-center justify-between border-t border-border px-4 py-3"><Button size="sm" variant="ghost" disabled={!page} onClick={() => setPage((p) => p - 1)}>Anterior</Button><span className="text-xs text-muted">Página {page + 1} de {Math.ceil(visible.length / 25)}</span><Button size="sm" variant="ghost" disabled={(page + 1) * 25 >= visible.length} onClick={() => setPage((p) => p + 1)}>Próxima</Button></div>}
      </div><p className="text-xs leading-relaxed text-muted">Uma pessoa pode ter mais de uma ação. Respostas indicam a última mensagem de e-mail consultada, sem envio posterior fora das categorias automação e transacional; confira também os outros canais no histórico. Teste encerrado não significa pagamento pendente.</p>
    </>}
  </div>;
}
