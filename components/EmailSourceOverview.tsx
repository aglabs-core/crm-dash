'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/format';
import { emailCategoryLabel, emailSourceLabel, SOURCE_ORDER, type EmailSourceSummary } from '@/lib/email-ledger';
import { Card } from '@/components/ui';
import { Button } from '@/components/ui';
import { EMAIL_PAGE_SIZE, EMAIL_WORKSPACES, type EmailWorkspace } from '@/lib/email-workspace';

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

/** Automatic sequences and prospecting batches, from the unified e-mail ledger. */
export function EmailSourceOverview({ product = 'barberias', workspace = 'sistema' }: { product?: string; workspace?: EmailWorkspace }) {
  const [rows, setRows] = useState<EmailSourceSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let query = supabase.from('email_source_summary').select('*')
      .in('category', EMAIL_WORKSPACES.find((w) => w.id === workspace)!.categories);
    query = product === '__undefined__' ? query.is('product', null) : query.eq('product', product);
    query.order('last_sent_at', { ascending: false }).order('source_key').order('category')
      .range(page * EMAIL_PAGE_SIZE, (page + 1) * EMAIL_PAGE_SIZE).abortSignal(controller.signal).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error) setFailed(true);
      else { setRows((data ?? []).slice(0, EMAIL_PAGE_SIZE) as EmailSourceSummary[]); setHasNext((data?.length ?? 0) > EMAIL_PAGE_SIZE); }
    });
    return () => controller.abort();
  }, [product, workspace, page]);

  if (failed) return <p role="alert" className="text-sm text-muted">Não foi possível consultar os envios registrados.</p>;
  if (!rows) return <p role="status" className="text-sm text-muted">Carregando envios…</p>;
  if (rows.length === 0 && page === 0) return <Card className="p-5 text-sm text-muted">Nenhum envio registrado neste grupo.</Card>;
  const order = (key: string) => { const i = SOURCE_ORDER.indexOf(key); return i < 0 ? 100 : i; };
  const sorted = [...rows].sort((a, b) => order(a.source_key) - order(b.source_key)
    || Date.parse(b.last_sent_at) - Date.parse(a.last_sent_at));

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-5">
        <h2 className="font-semibold text-fg">{workspace === 'sistema' ? 'Testes, recuperação e mensagens do sistema' : workspace === 'prospeccao' ? 'Lotes de prospecção' : 'Envios de campanhas'}</h2>
        <p className="mt-1 text-xs text-muted">Histórico acumulado por mensagem neste produto e grupo. Taxa de entrega: entregues / registrados. Aberturas e cliques são sinais auxiliares.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-border">
              <th className="p-3 font-medium">Origem</th><th className="p-3 font-medium">Tipo</th>
              <th className="p-3 text-right font-medium">Enviados</th><th className="p-3 text-right font-medium">Entregues</th>
              <th className="p-3 text-right font-medium">Abertos</th><th className="p-3 text-right font-medium">Cliques</th>
              <th className="p-3 text-right font-medium">Respostas</th><th className="p-3 text-right font-medium">Falhas</th>
              <th className="p-3 font-medium">Último envio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((row) => (
              <tr key={`${row.product}:${row.category}:${row.source_key}`}>
                <td className="p-3 text-fg">{emailSourceLabel(row.source_key)}</td>
                <td className="p-3 text-muted">{emailCategoryLabel(row.category)}</td>
                <td className="p-3 text-right text-fg">{row.sent}</td>
                <td className="p-3 text-right text-fg">{row.delivered} <span className="text-xs text-muted">{pct(row.delivered, row.sent)}</span></td>
                <td className="p-3 text-right text-fg">{row.opened}</td>
                <td className="p-3 text-right text-fg">{row.clicked}</td>
                <td className="p-3 text-right font-medium text-emerald-600">{row.replied}</td>
                <td className="p-3 text-right text-fg">{row.failed + row.opted_out}</td>
                <td className="p-3 text-muted">{formatRelative(row.last_sent_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border p-3 text-sm">
        <span className="text-muted">Página {page + 1}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => { setRows(null); setFailed(false); setPage(page - 1); }}>Anterior</Button>
          <Button variant="secondary" disabled={!hasNext} onClick={() => { setRows(null); setFailed(false); setPage(page + 1); }}>Próxima</Button>
        </div>
      </div>
    </Card>
  );
}
