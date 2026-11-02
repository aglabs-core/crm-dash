'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Button, Card } from '@/components/ui';
type Recipient = { contact_id: string; recipient_id: string; reasons: string[] };
export function CampaignFollowupReview({ campaignId, legacySecond = false }: { campaignId: string; legacySecond?: boolean }) {
  return legacySecond ? <HistoricalSecondReview key={campaignId} campaignId={campaignId} /> : <ReadOnlyFollowupReview campaignId={campaignId} />;
}
function ReadOnlyFollowupReview({ campaignId }: { campaignId: string }) {
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

type HistoricalReview = {
  campaign_id: string; fingerprint: string;
  policy: { version: string; waitSeconds: number; subject: string; text: string; format: string };
  recipients: (Recipient & { email: string; name: string; parent: { subject: string; text: string; delivered_at: string | null } | null;
    message: { subject: string; text: string } })[];
};
type HistoricalBatch = { id: string; state: 'draft' | 'approved' | 'paused'; review: HistoricalReview };
function parseHistorical(value: unknown, campaignId: string): HistoricalReview {
  const r = value as HistoricalReview;
  if (!r || r.campaign_id !== campaignId || typeof r.fingerprint !== 'string' || !r.fingerprint
    || r.policy?.version !== 'barberias-prospect-second-v1' || r.policy.waitSeconds !== 604800 || r.policy.format !== 'text_only'
    || typeof r.policy.subject !== 'string' || typeof r.policy.text !== 'string' || !Array.isArray(r.recipients)
    || !r.recipients.every((x) => typeof x.recipient_id === 'string' && typeof x.contact_id === 'string' && typeof x.email === 'string'
      && Array.isArray(x.reasons) && x.reasons.every((v) => typeof v === 'string') && typeof x.message?.subject === 'string' && typeof x.message.text === 'string'
      && (x.parent === null || (typeof x.parent?.subject === 'string' && typeof x.parent?.text === 'string')))) throw Error('Invalid historical review');
  return r;
}
function HistoricalSecondReview({ campaignId }: { campaignId: string }) {
  const [review, setReview] = useState<HistoricalReview | null>(null);
  const [batch, setBatch] = useState<HistoricalBatch | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const key = useRef('');
  async function readBatch() {
    const { data, error } = await supabase.rpc('get_campaign_legacy_second', { p_campaign: campaignId });
    if (error) throw error;
    if (data === null) return null;
    if (typeof data?.id !== 'string' || !['draft', 'approved', 'paused'].includes(data.state)) throw Error('Invalid batch');
    return { id: data.id, state: data.state, review: parseHistorical(data.review, campaignId) } as HistoricalBatch;
  }
  async function act(action: 'review' | 'prepare' | 'approve' | 'cancel') {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(false); setNotice('');
    try {
      if (action === 'review') {
        setSelected([]); setNote('');
        const existing = await readBatch();
        if (existing) { setBatch(existing); setReview(existing.review); }
        else {
          const { data, error } = await supabase.rpc('review_campaign_legacy_second', { p_campaign: campaignId });
          if (error) throw error;
          setBatch(null); setReview(parseHistorical(data, campaignId));
        }
        key.current = crypto.randomUUID();
      } else if (action === 'prepare' && review) {
        const { data, error } = await supabase.rpc('prepare_campaign_legacy_second', { p_campaign: campaignId, p_fingerprint: review.fingerprint });
        if (error || typeof data?.batch_id !== 'string') throw Error('Preparation not confirmed');
        const saved = await readBatch();
        if (!saved || saved.id !== data.batch_id || saved.review.fingerprint !== review.fingerprint) throw Error('Readback mismatch');
        setBatch(saved); setReview(saved.review); setSelected([]);
        setNotice('Rascunho histórico congelado; nenhuma mensagem enviada.');
      } else if (action === 'approve' && review && batch?.state === 'draft' && selected.length && note.trim().length >= 8) {
        const { data, error } = await supabase.rpc('approve_campaign_legacy_second', { p_batch: batch.id, p_fingerprint: review.fingerprint,
          p_recipients: selected, p_key: key.current, p_note: note.trim() });
        if (error || data?.batch_id !== batch.id || data.status !== 'approved') throw Error('Approval not confirmed');
        const saved = await readBatch();
        if (!saved || saved.id !== batch.id || saved.state !== 'approved') throw Error('Readback mismatch');
        setBatch(saved); setNotice('Segunda etapa aprovada; envio continua desativado.');
      } else if (action === 'cancel' && batch) {
        const { error } = await supabase.rpc('set_email_campaign_batch_state', { p_batch_id: batch.id, p_state: 'cancelled' });
        if (error || await readBatch() !== null) throw Error('Cancellation not confirmed');
        setBatch(null); setReview(null); setSelected([]); setNotice('Versão cancelada; histórico preservado. Confira novamente para preparar uma nova revisão.');
      }
    } catch { setError(true); setSelected([]); }
    finally { operation.current = false; setBusy(false); }
  }
  return <Card className="space-y-3 p-5">
    <h2 className="font-semibold">Segunda etapa de prospecção</h2>
    <p className="text-sm text-muted">Barberias: uma segunda mensagem, 7 dias (604800 segundos) após entrega comprovada. Rascunho somente texto; HTML e aprovação do envio inicial não são reconstruídos. Nenhum envio ou ativação nesta tela.</p>
    <Button variant="secondary" disabled={busy} onClick={() => act('review')}>Conferir impedimentos da segunda etapa</Button>
    {error && <p role="alert">Operação não confirmada. A revisão pode estar desatualizada. Confira novamente ou cancele a versão antes de preparar outra; nenhuma mensagem foi enviada.</p>}
    {notice && <p role="status">{notice}</p>}
    {review && <>
      <p className="text-sm">Versão: {review.policy.version} · {batch?.state ?? 'prévia não salva'}</p>
      <ul className="space-y-3">{review.recipients.map((r) => <li key={r.recipient_id} className="rounded border border-border p-3 text-sm">
        <Link href={`/contacts/${r.contact_id}`} className="text-brand underline">{r.email}</Link>
        <p>Impedimentos: {r.reasons.length ? r.reasons.join(' · ') : 'Nenhum na revisão congelada; servidor verificará novamente.'}</p>
        {r.parent && <details open><summary>Inicial original · entrega: {r.parent.delivered_at ?? 'não comprovada'}</summary><p>{r.parent.subject}</p><p className="whitespace-pre-wrap">{r.parent.text}</p></details>}
        <p className="font-medium">{r.message.subject}</p><p className="whitespace-pre-wrap">{r.message.text}</p>
        {batch?.state === 'draft' && <label className="flex gap-2"><input type="checkbox" aria-label={`Revisado ${r.email}`} disabled={busy || r.reasons.length > 0}
          checked={selected.includes(r.recipient_id)} onChange={(e) => setSelected((s) => e.target.checked ? [...s, r.recipient_id] : s.filter((id) => id !== r.recipient_id))} />Revisei este destinatário e o texto final</label>}
      </li>)}</ul>
      {!batch && <Button disabled={busy} onClick={() => act('prepare')}>Preparar rascunho histórico</Button>}
      {batch?.state === 'draft' && <>
        <label className="block">Nota da revisão manual<textarea aria-label="Nota da revisão manual" disabled={busy} value={note} onChange={(e) => setNote(e.target.value)} className="block w-full rounded border border-border p-2" /></label>
        <Button disabled={busy || !selected.length || note.trim().length < 8} onClick={() => act('approve')}>Aprovar segunda etapa sem envio</Button>
      </>}
      {batch && <Button variant="secondary" disabled={busy} onClick={() => act('cancel')}>Cancelar versão histórica sem apagar evidências</Button>}
    </>}
  </Card>;
}
