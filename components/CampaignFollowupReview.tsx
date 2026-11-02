'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button, Card } from '@/components/ui';
type Recipient = { contact_id: string; recipient_id: string; reasons: string[] };
export function CampaignFollowupReview({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function review() {
    setLoading(true); setError(false); setRows(null);
    try {
      const { data, error } = await supabase.rpc('review_email_campaign_followup', { p_campaign_id: campaignId, p_wait_hours: null });
      if (error || data?.campaign_id !== campaignId || data.mode !== 'preparation_only' || data.executor_available !== false
        || !Array.isArray(data.recipients) || !data.recipients.every((r: Recipient) => typeof r.contact_id === 'string' && typeof r.recipient_id === 'string' && Array.isArray(r.reasons) && r.reasons.every((reason) => typeof reason === 'string'))) throw new Error('Review unavailable');
      setRows(data.recipients);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  return <Card className="space-y-3 p-5">
    <h2 className="font-semibold">Segunda etapa de prospecção</h2>
    <p className="text-sm text-muted">Executor automático não implementado. Templates e campanha concluída não agendam uma segunda mensagem. Texto final e intervalo precisam de aprovação; o ciclo de teste do produto é separado.</p>
    <Button variant="secondary" loading={loading} onClick={review}>Conferir impedimentos da segunda etapa</Button>
    {error && <p role="alert">Revisão indisponível. Confira acesso e migração; nenhuma mensagem foi enviada.</p>}
    {rows && <ul className="space-y-2 text-sm">{rows.map((r) => <li key={r.recipient_id}><Link href={`/contacts/${r.contact_id}`} className="text-brand underline">Revisar contato</Link><ul>{r.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></li>)}</ul>}
    <p className="text-xs text-muted">Consulta somente de leitura. Não reserva, não aprova nem dispara envios. Verificar novamente antes de qualquer execução futura.</p>
  </Card>;
}
