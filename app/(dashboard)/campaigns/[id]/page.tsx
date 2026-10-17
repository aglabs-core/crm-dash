'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Mail, MailOpen, MousePointerClick, Reply, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { BrevoMessageLink } from '@/components/BrevoMessageLink';
import { CampaignPreparation } from '@/components/CampaignPreparation';
import { CampaignApproval } from '@/components/CampaignApproval';
import { loadContacts } from '@/lib/contact-data';
import type { Contact } from '@/lib/types';
import {
  campaignMetrics, recipientEventSummary, emailEventLabel, type EmailCampaign, type EmailCampaignEvent,
  type EmailCampaignRecipient,
} from '@/lib/email-campaign';
import { Badge, Button, Card, PageLoader, StatCard } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';

async function loadRecipients(campaignId: string): Promise<EmailCampaignRecipient[]> {
  const rows: EmailCampaignRecipient[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('email_campaign_recipients')
      .select('id,campaign_id,contact_id,email_snapshot,review_note,provider_message_id,added_at')
      .eq('campaign_id', campaignId).order('added_at', { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as EmailCampaignRecipient[]);
    if (!data || data.length < 500) break;
  }
  return rows;
}

async function loadEvents(recipientIds: string[]): Promise<EmailCampaignEvent[]> {
  const rows: EmailCampaignEvent[] = [];
  for (let start = 0; start < recipientIds.length; start += 100) {
    const ids = recipientIds.slice(start, start + 100);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('email_campaign_events')
        .select('id,recipient_id,event_type,occurred_at,provider_event_type').in('recipient_id', ids)
        .order('occurred_at', { ascending: true }).range(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data ?? []) as EmailCampaignEvent[]);
      if (!data || data.length < 500) break;
    }
  }
  return rows;
}

async function loadCampaignSnapshot(id: string) {
  const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id).single();
  if (error) throw error;
  const recipients = await loadRecipients(id);
  const events = await loadEvents(recipients.map((row) => row.id));
  return { campaign: data as EmailCampaign, recipients, events };
}

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [recipients, setRecipients] = useState<EmailCampaignRecipient[]>([]);
  const [events, setEvents] = useState<EmailCampaignEvent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [approvalLocked, setApprovalLocked] = useState(true);
  const confirm = useConfirm();

  const applySnapshot = useCallback((snapshot: { campaign: EmailCampaign; recipients: EmailCampaignRecipient[]; events: EmailCampaignEvent[] }) => {
    setCampaign(snapshot.campaign); setRecipients(snapshot.recipients); setEvents(snapshot.events);
  }, []);
  const refresh = useCallback(() => loadCampaignSnapshot(id).then(applySnapshot), [id, applySnapshot]);

  useEffect(() => {
    let active = true;
    Promise.all([loadCampaignSnapshot(id), loadContacts(), supabase.auth.getUser()])
      .then(([snapshot, rows, auth]) => {
        if (!active) return;
        applySnapshot(snapshot); setContacts(rows); setViewerId(auth.data.user?.id ?? null);
      }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, applySnapshot]);

  const metrics = useMemo(() => campaignMetrics(recipients, events), [recipients, events]);
  const removeRecipient = async (recipient: EmailCampaignRecipient) => {
    if (!campaign || campaign.status !== 'draft' || campaign.user_id !== viewerId || (campaign.provider === 'brevo' && approvalLocked)) return;
    const approved = await confirm({
      title: 'Remover destinatário',
      description: 'Este contato sairá do rascunho. Nenhum evento de envio será alterado.',
      confirmText: 'Remover',
    });
    if (!approved) return;
    const { error: deleteError } = await supabase.from('email_campaign_recipients')
      .delete().eq('id', recipient.id);
    if (deleteError) toast.error('Não foi possível remover o contato.');
    else await refresh();
  };

  if (loading) return <PageLoader />;
  if (error || !campaign) return <p className="text-sm text-red-500">Campanha indisponível. Confira o acesso e a migration.</p>;

  const contactNames = new Map(contacts.map((contact) => [contact.id, contact.name || contact.email || 'Contato']));
  const eventSummaries = recipientEventSummary(events);
  const hasProviderHistory = events.length > 0 || recipients.some((recipient) => recipient.provider_message_id);
  const canPrepare = campaign.status === 'draft' && campaign.user_id === viewerId
    && (campaign.provider !== 'brevo' || !approvalLocked) && !hasProviderHistory;
  const reviewUnavailableReason = campaign.status !== 'draft' || hasProviderHistory
    ? 'A revisão para aprovação está disponível apenas em rascunhos sem histórico de envio.'
    : recipients.length === 0 || !campaign.content_text?.trim()
      ? 'Salve o público e o texto em Preparar campanha antes de revisar a aprovação.'
      : recipients.length > 200 ? 'A aprovação aceita até 200 destinatários por versão. Ajuste o público antes de revisar.' : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Campanhas</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">{campaign.name}</h1>
          <p className="mt-1 text-sm text-muted">{campaign.product} · {campaign.provider.toUpperCase()} · {campaign.sender_email}</p>
          <p className="mt-1 text-sm text-fg">{campaign.subject}</p>
        </div>
        <Badge tone={campaign.status === 'draft' ? 'gray' : 'indigo'}>{campaign.status === 'draft' ? 'Rascunho' : campaign.status}</Badge>
      </div>
      <Link href={`/campaigns/templates?product=${encodeURIComponent(campaign.product)}`} className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"><Mail className="h-4 w-4" /> Consultar templates do produto</Link>
      {canPrepare && <CampaignPreparation key={campaign.id} campaign={campaign} contacts={contacts} recipients={recipients} onSaved={refresh} />}
      {campaign.provider === 'brevo' && campaign.user_id === viewerId && <CampaignApproval campaignId={campaign.id} onChanged={refresh} canReview={!reviewUnavailableReason} reviewUnavailableReason={reviewUnavailableReason} onLockChange={setApprovalLocked} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Na audiência" value={metrics.recipients} icon={Mail} hint={`${metrics.pending} sem qualquer evento`} />
        <StatCard label="Entregues" value={metrics.delivered} icon={CheckCircle2} hint={`${metrics.sent} envios registrados`} />
        <StatCard label="Aberturas" value={metrics.opened} icon={MailOpen} hint={`${metrics.clicked} cliques`} />
        <StatCard label="Respostas" value={metrics.replied} icon={Reply} hint={`${metrics.bounced} rejeições`} />
      </div>
      <Card className="p-5">
        <h2 className="font-semibold text-fg">Saúde do envio</h2>
        <div className="mt-3 flex flex-wrap gap-5 text-sm text-muted">
          <span className="inline-flex items-center gap-1"><MousePointerClick className="h-4 w-4" /> Cliques: {metrics.clicked}</span>
          <span className="inline-flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> Bounces: {metrics.bounced}</span>
          <span>Adiadas: {metrics.deferred}</span><span>Bloqueadas: {metrics.blocked}</span><span>Erros: {metrics.error}</span><span>Aberturas por proxy: {metrics.proxy_open}</span><span>Reclamações: {metrics.complained}</span><span>Descadastros: {metrics.unsubscribed}</span>
        </div>
        <p className="mt-3 text-xs text-muted">Indicadores contam destinatários únicos. Eventos só aparecem quando o conector do provedor os registrar; zero não significa que houve entrega.</p>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border p-5"><h2 className="font-semibold text-fg">Destinatários e eventos</h2></div>
        {recipients.length === 0 ? <p className="p-5 text-sm text-muted">Nenhum destinatário registrado.</p> : (
          <div className="divide-y divide-border">
            {recipients.map((recipient) => (
              <div key={recipient.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <Link href={`/contacts/${recipient.contact_id}`} className="font-medium text-brand hover:underline">{contactNames.get(recipient.contact_id) || recipient.email_snapshot}</Link>
                  <p className="text-muted">{recipient.email_snapshot}</p>
                  <p className="mt-1 text-xs text-muted">Revisão: {recipient.review_note}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={eventSummaries.get(recipient.id)?.delivery ? 'indigo' : 'gray'}>{eventSummaries.get(recipient.id)?.delivery ? emailEventLabel(eventSummaries.get(recipient.id)!.delivery!.event_type) : 'Sem evento de entrega'}</Badge>
                  {eventSummaries.get(recipient.id)?.engagement && <Badge tone="blue">{emailEventLabel(eventSummaries.get(recipient.id)!.engagement!.event_type)}</Badge>}
                  {eventSummaries.get(recipient.id)?.unsubscribed && <Badge tone="red">Descadastrado</Badge>}
                  {eventSummaries.get(recipient.id)?.complained && <Badge tone="red">Reclamação</Badge>}
                  {eventSummaries.get(recipient.id)?.hardBounce && <Badge tone="red">Falha permanente</Badge>}
                  {campaign.status === 'draft' && campaign.user_id === viewerId && (campaign.provider !== 'brevo' || !approvalLocked) && !recipient.provider_message_id && !events.some((item) => item.recipient_id === recipient.id) && (
                    <button type="button" onClick={() => removeRecipient(recipient)}
                      aria-label={`Remover ${recipient.email_snapshot}`} className="text-muted hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {campaign.provider === 'brevo' && campaign.user_id === viewerId && !recipient.provider_message_id && <BrevoMessageLink recipientId={recipient.id} onLinked={refresh} />}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
