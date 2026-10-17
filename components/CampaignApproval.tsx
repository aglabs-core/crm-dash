'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  campaignBatchStateLabel, readCampaignApprovalBatches, readCampaignApprovalReview,
  type CampaignApprovalBatch, type CampaignApprovalRecipient, type CampaignApprovalReview,
} from '@/lib/campaign-approval';
import { useConfirm } from '@/components/ConfirmDialog';
import { Badge, Button, Card, Checkbox, Field, Textarea } from '@/components/ui';

type Props = {
  campaignId: string;
  onChanged: () => Promise<void>;
  canReview?: boolean;
  reviewUnavailableReason?: string;
  onLockChange?: (locked: boolean) => void;
};

function FinalMessage({ recipient }: { recipient: CampaignApprovalRecipient }) {
  return <details className="rounded-lg border border-border p-3">
    <summary className="cursor-pointer break-all text-sm font-medium text-fg">
      {recipient.name || 'Contato'} · {recipient.email}
    </summary>
    <div className="mt-3 space-y-2 text-sm">
      {recipient.reason && <p className="text-red-600 dark:text-red-400">Bloqueado: {recipient.reason}</p>}
      <p className="break-words font-medium text-fg">Assunto: {recipient.subject}</p>
      <p className="whitespace-pre-wrap break-words text-muted">{recipient.content}</p>
    </div>
  </details>;
}

export function CampaignApproval(props: Props) {
  return <CampaignApprovalPanel key={props.campaignId} {...props} />;
}

function CampaignApprovalPanel({ campaignId, onChanged, canReview = true, reviewUnavailableReason, onLockChange }: Props) {
  const [batches, setBatches] = useState<CampaignApprovalBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<CampaignApprovalReview | null>(null);
  const [approvalKey, setApprovalKey] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const operation = useRef(false);
  const mounted = useRef(true);
  const lockListener = useRef(onLockChange);
  const confirm = useConfirm();

  useEffect(() => { lockListener.current = onLockChange; }, [onLockChange]);

  const fetchOverview = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('campaign_batch_overview', { p_campaign_id: campaignId });
    if (rpcError) throw rpcError;
    return readCampaignApprovalBatches(data);
  }, [campaignId]);

  useEffect(() => {
    mounted.current = true;
    lockListener.current?.(true);
    let active = true;
    fetchOverview().then((rows) => { if (active) { setBatches(rows); lockListener.current?.(rows.some((batch) => batch.state !== 'cancelled')); } })
      .catch(() => { if (active) { setOverviewError(true); lockListener.current?.(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [fetchOverview]);

  const refresh = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const rows = await fetchOverview();
      if (mounted.current) { setBatches(rows); setOverviewError(false); lockListener.current?.(rows.some((batch) => batch.state !== 'cancelled')); }
    } catch { if (mounted.current) { setOverviewError(true); lockListener.current?.(true); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const startReview = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    setReview(null); setConfirmed(false); setApprovalKey(''); setNote('');
    try {
      const { data, error: rpcError } = await supabase.rpc('review_email_campaign_batch', { p_campaign_id: campaignId });
      if (rpcError) throw rpcError;
      const next = readCampaignApprovalReview(data, campaignId);
      const key = crypto.randomUUID();
      if (mounted.current) { setReview(next); setApprovalKey(key); }
    } catch { if (mounted.current) setError('Não foi possível revisar a preparação. Atualize a situação e tente novamente.'); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const afterMutation = async (message: string) => {
    if (!mounted.current) return;
    setNotice(message);
    try {
      const rows = await fetchOverview();
      if (!mounted.current) return;
      setBatches(rows); setOverviewError(false);
      lockListener.current?.(rows.some((batch) => batch.state !== 'cancelled'));
      await onChanged();
    } catch {
      if (mounted.current) {
        setOverviewError(true);
        lockListener.current?.(true);
        setError('A alteração foi registrada, mas a tela não atualizou. Atualize a situação antes de continuar.');
      }
    }
  };

  const approve = async () => {
    if (!review || !approvalKey || operation.current || !confirmed || note.trim().length < 8
      || !review.recipients.length || review.recipients.some((row) => row.reason)) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    lockListener.current?.(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_email_campaign_batch', {
        p_campaign_id: campaignId, p_fingerprint: review.fingerprint, p_approval_key: approvalKey, p_note: note.trim(),
      });
      if (rpcError || typeof data !== 'string' || !data) throw new Error('Approval unconfirmed');
      if (!mounted.current) return;
      setReview(null); setConfirmed(false);
      await afterMutation('Versão aprovada e congelada. Nenhum e-mail foi enviado.');
    } catch {
      if (mounted.current) {
        setConfirmed(false);
        lockListener.current?.(true);
        setError('A aprovação não foi confirmada. Os dados podem ter mudado. Atualize a situação ou revise novamente; uma nova tentativa da mesma revisão mantém a mesma chave.');
      }
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const changeState = async (batch: CampaignApprovalBatch, state: CampaignApprovalBatch['state']) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const accepted = await confirm({
        title: state === 'cancelled' ? 'Cancelar aprovação' : state === 'paused' ? 'Pausar preparação aprovada' : 'Retomar preparação aprovada',
        description: 'O histórico e os vínculos existentes serão preservados. Esta ação não envia nem cancela mensagens já aceitas pela Brevo.',
        confirmText: state === 'cancelled' ? 'Cancelar aprovação' : state === 'paused' ? 'Pausar preparação' : 'Retomar preparação',
        tone: state === 'cancelled' ? 'danger' : 'default',
      });
      if (!accepted || !mounted.current) return;
      const { error: rpcError } = await supabase.rpc('set_email_campaign_batch_state', { p_batch_id: batch.id, p_state: state });
      if (rpcError) throw rpcError;
      await afterMutation(state === 'cancelled' ? 'Aprovação cancelada. O histórico foi preservado.' : state === 'paused' ? 'Preparação aprovada pausada.' : 'Preparação aprovada retomada. Nenhum e-mail foi enviado.');
    } catch { if (mounted.current) setError('Não foi possível confirmar a alteração. Atualize a situação antes de tentar novamente.'); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };

  const hasCurrentBatch = batches.some((batch) => batch.state !== 'cancelled');
  const blocked = review?.recipients.filter((row) => row.reason).length || 0;

  return <Card className="space-y-5 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="inline-flex items-center gap-2 text-lg font-semibold text-fg"><ClipboardCheck className="h-5 w-5" /> Preparação aprovada</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">Congele o público e as mensagens para a execução externa pelo agente. O CRM acompanha os IDs e os resultados; o envio automático ainda não está disponível.</p></div>
      <Badge tone="gray">Sem disparo automático</Badge>
    </div>
    {loading ? <p role="status" className="text-sm text-muted">Carregando aprovações…</p> : <>
      <Button variant="secondary" size="sm" loading={busy} onClick={refresh}><RefreshCw className="h-4 w-4" /> Atualizar situação</Button>
      {overviewError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Não foi possível conferir a fila aprovada. Atualize a situação antes de continuar.</p>}
      {!overviewError && !hasCurrentBatch && canReview && <div className="space-y-2">
        <p className="text-sm text-muted">{batches.length ? 'As versões anteriores continuam no histórico. Revise os dados atuais para aprovar outra versão.' : 'Nenhuma versão aprovada registrada.'}</p>
        <Button disabled={busy} variant="secondary" onClick={startReview}>{review ? 'Revisar novamente' : 'Revisar versão para aprovação'}</Button>
      </div>}
      {!overviewError && !hasCurrentBatch && !canReview && <p className="text-sm text-muted">{reviewUnavailableReason || 'A revisão para aprovação está disponível apenas em rascunhos sem histórico de envio.'}</p>}
      {review && canReview && !overviewError && !hasCurrentBatch && <section aria-label="Revisão final para aprovação" className="space-y-4 rounded-xl border border-border p-4">
        <div className="space-y-1 break-words text-sm"><p className="font-medium text-fg">{review.recipients.length} destinatário(s) · {review.product}</p>
          <p className="text-muted">De: {review.sender_email}</p><p className="text-muted">Respostas: {review.reply_to || review.sender_email}</p></div>
        <p className="text-xs text-muted">Os textos abaixo já estão personalizados. A aprovação congela exatamente esta versão. Os motivos são revalidados ao revisar e aprovar; use Atualizar situação para conferir alterações posteriores.</p>
        {review.recipients.length === 0 && <p className="text-sm text-red-600 dark:text-red-400">Inclua destinatários na preparação antes de aprovar.</p>}
        {blocked > 0 && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{blocked} destinatário(s) com impedimento. Corrija a preparação e revise novamente antes de aprovar.</p>}
        <div className="max-h-96 space-y-2 overflow-y-auto">{review.recipients.map((row) => <FinalMessage key={row.recipient_id} recipient={row} />)}</div>
        <Field label="Nota da aprovação" htmlFor="campaign-approval-note" required hint="Registre o motivo e o contexto desta versão aprovada.">
          <Textarea id="campaign-approval-note" value={note} maxLength={1000} disabled={busy} onChange={(event) => { setNote(event.target.value); setConfirmed(false); }} />
        </Field>
        <label className="flex items-start gap-3 text-sm text-fg"><Checkbox checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} aria-label="Confirmar versão final da preparação" />Revisei os destinatários e os textos finais desta versão.</label>
        <Button loading={busy} disabled={!confirmed || note.trim().length < 8 || blocked > 0 || !review.recipients.length} onClick={approve}>Congelar aprovação sem enviar</Button>
      </section>}
      {batches.map((batch) => <section key={batch.id} aria-label={`Versão ${batch.id}`} className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><Badge tone={batch.state === 'approved' ? 'indigo' : 'gray'}>{campaignBatchStateLabel(batch.state)}</Badge>
          <p className="text-xs text-muted">Aprovada em {new Date(batch.approved_at).toLocaleString('pt-BR')}</p></div>
        <p className="break-words text-sm text-muted">Nota: {batch.approval_note}</p>
        <div className="space-y-1 break-words text-sm text-muted"><p>De: {batch.sender_email}</p><p>Respostas: {batch.reply_to || batch.sender_email}</p><p>Assunto base: {batch.subject}</p></div>
        <p className="text-xs text-muted">{batch.recipients.length} destinatário(s) · conteúdo preservado nesta versão</p>
        <div className="max-h-96 space-y-2 overflow-y-auto">{batch.recipients.map((row) => <div key={row.recipient_id} className="space-y-1">
          <FinalMessage recipient={row} />
          <p className="break-all text-xs text-muted">{row.provider_message_id ? `Envio externo vinculado: ${row.provider_message_id}` : 'Sem ID de envio externo vinculado'}</p>
        </div>)}</div>
        {batch.state !== 'cancelled' && <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy || overviewError} onClick={() => changeState(batch, batch.state === 'approved' ? 'paused' : 'approved')}>{batch.state === 'approved' ? 'Pausar aprovação' : 'Retomar aprovação'}</Button>
          <Button size="sm" variant="ghost" disabled={busy || overviewError} onClick={() => changeState(batch, 'cancelled')}>Cancelar aprovação</Button>
        </div>}
      </section>)}
    </>}
    {notice && <p role="status" className="text-sm text-fg">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
  </Card>;
}
