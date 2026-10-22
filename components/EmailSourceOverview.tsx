'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/format';
import { emailCategoryLabel, emailSourceLabel, SOURCE_ORDER, type EmailSourceSummary } from '@/lib/email-ledger';
import { Card } from '@/components/ui';

const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

/** Automatic sequences and prospecting batches, from the unified e-mail ledger. */
export function EmailSourceOverview() {
  const [rows, setRows] = useState<EmailSourceSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from('email_source_summary').select('*').then(({ data, error }) => {
      if (!active) return;
      if (error) setFailed(true);
      else setRows(((data ?? []) as EmailSourceSummary[]).filter((row) => row.category !== 'atendimento'));
    });
    return () => { active = false; };
  }, []);

  if (failed || !rows || rows.length === 0) return null;
  const order = (key: string) => { const i = SOURCE_ORDER.indexOf(key); return i < 0 ? 100 : i; };
  const sorted = [...rows].sort((a, b) => order(a.source_key) - order(b.source_key)
    || Date.parse(b.last_sent_at) - Date.parse(a.last_sent_at));

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-5">
        <h2 className="font-semibold text-fg">Automações e envios registrados</h2>
        <p className="mt-1 text-xs text-muted">Inclui os e-mails automáticos do sistema e os lotes de prospecção. Contagem por mensagem; aberturas e cliques são sinais auxiliares.</p>
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
              <tr key={`${row.category}:${row.source_key}`}>
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
    </Card>
  );
}
