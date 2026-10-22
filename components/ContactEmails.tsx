'use client';

import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  emailCategoryLabel, emailSourceLabel, emailStatusMeta, type EmailMessage, type EmailMessageEvent,
} from '@/lib/email-ledger';
import { Badge, Card, CardBody, CardHeader, CardTitle, Modal } from '@/components/ui';
import { Button } from '@/components/ui';
import { EmailPreview } from '@/components/EmailPreview';

const LIST_COLUMNS = 'id,contact_id,direction,provider,category,source_key,product,campaign_id,address,from_address,reply_to,subject,summary,status,sent_at,status_at,delivered_at,opened_at,clicked_at,replied_at,bounced_at';

/** Every e-mail sent to or received from this contact, with the provider's latest status. */
export function ContactEmails({ contactId }: { contactId: string }) {
  return <ContactEmailHistory key={contactId} contactId={contactId} />;
}

function ContactEmailHistory({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [detail, setDetail] = useState<{ body_html: string | null; body_text: string | null; events: EmailMessageEvent[] } | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    supabase.from('email_messages').select(LIST_COLUMNS).eq('contact_id', contactId).order('sent_at', { ascending: false }).order('id')
      .range(page * 25, page * 25 + 25).abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (controller.signal.aborted) return;
        if (error) setState('unavailable');
        else { setMessages((data ?? []).slice(0, 25) as EmailMessage[]); setHasNext((data?.length ?? 0) > 25); setState('ready'); }
      });
    return () => controller.abort();
  }, [contactId, page]);

  const open = (message: EmailMessage) => {
    setSelected(message); setDetail(null); setDetailError(false);
  };

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const content = async () => {
      const result = await supabase.from('email_messages').select('body_html,body_text').eq('id', selected.id)
        .abortSignal(controller.signal).maybeSingle();
      if (result.error) throw new Error('Content unavailable');
      if (result.data?.body_html || result.data?.body_text || selected.provider !== 'resend') return result.data;
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session) throw new Error('Session unavailable');
      const response = await fetch(`/api/emails/${selected.id}/content`, {
        headers: { Authorization: `Bearer ${auth.session.access_token}` }, cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Content unavailable');
      return response.json() as Promise<{ body_html: string | null; body_text: string | null }>;
    };
    Promise.all([content(), supabase.from('email_message_events').select('id,message_id,event_type,provider_event_type,occurred_at')
      .eq('message_id', selected.id).order('occurred_at', { ascending: true }).abortSignal(controller.signal)])
      .then(([body, events]) => {
        if (controller.signal.aborted) return;
        if (events.error) throw new Error('Events unavailable');
        setDetail({ body_html: body?.body_html ?? null, body_text: body?.body_text ?? null, events: (events.data ?? []) as EmailMessageEvent[] });
      }).catch(() => { if (!controller.signal.aborted) setDetailError(true); });
    return () => controller.abort();
  }, [selected, revision]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mails</CardTitle>
        <span className="text-sm text-muted">{state === 'ready' ? `Página ${page + 1}` : ''}</span>
      </CardHeader>
      <CardBody className="space-y-2">
        {state === 'loading' && <p className="py-4 text-center text-sm text-muted">Carregando…</p>}
        {state === 'unavailable' && <p className="py-4 text-center text-sm text-muted">Histórico de e-mails indisponível. Confira a migração do banco.</p>}
        {state === 'ready' && messages.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">Nenhum e-mail registrado para este contato.</p>
        )}
        {messages.map((message) => {
          const status = emailStatusMeta(message.status);
          const Icon = message.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;
          return (
            <button key={message.id} type="button" onClick={() => open(message)}
              className="flex w-full items-start gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-surface-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${message.direction === 'inbound' ? 'text-emerald-500' : 'text-muted'}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-fg">{message.subject}</p>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">{emailCategoryLabel(message.category)} · {emailSourceLabel(message.source_key)} · {formatRelative(message.sent_at)}</p>
                {message.summary && <p className="mt-1 line-clamp-2 text-xs text-muted">{message.summary}</p>}
              </div>
            </button>
          );
        })}
        {state === 'ready' && <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => { setState('loading'); setMessages([]); setSelected(null); setPage(page - 1); }}>Anterior</Button>
          <Button size="sm" variant="secondary" disabled={!hasNext} onClick={() => { setState('loading'); setMessages([]); setSelected(null); setPage(page + 1); }}>Próxima</Button>
        </div>}
      </CardBody>
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.subject ?? 'E-mail'} size="lg">
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={emailStatusMeta(selected.status).tone}>{emailStatusMeta(selected.status).label}</Badge>
              <Badge tone="gray">{emailCategoryLabel(selected.category)}</Badge>
              <Badge tone="purple">{selected.provider === 'mailbox' ? 'Caixa de suporte' : selected.provider.toUpperCase()}</Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">{selected.direction === 'inbound' ? 'De' : 'Para'}</dt><dd className="text-fg">{selected.address}</dd>
              {selected.from_address && <><dt className="text-muted">Remetente</dt><dd className="text-fg">{selected.from_address}</dd></>}
              {selected.reply_to && <><dt className="text-muted">Respostas para</dt><dd className="text-fg">{selected.reply_to}</dd></>}
              <dt className="text-muted">Origem</dt><dd className="text-fg">{emailSourceLabel(selected.source_key)}</dd>
              <dt className="text-muted">Enviado</dt><dd className="text-fg">{formatDateTime(selected.sent_at)}</dd>
            </dl>
            {selected.summary && <p className="rounded-lg bg-surface-2 p-3 text-fg">{selected.summary}</p>}
            {detailError ? <p role="alert" className="text-muted">Não foi possível carregar o conteúdo. <button className="underline" onClick={() => { setDetailError(false); setDetail(null); setRevision((n) => n + 1); }}>Tentar novamente</button></p> : !detail ? <p className="text-muted">Carregando conteúdo…</p> : (
              <>
                {detail.body_html ? (
                  <EmailPreview key={selected.id} html={detail.body_html} />
                ) : detail.body_text ? (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-border p-3 text-xs text-fg">{detail.body_text}</pre>
                ) : (
                  <p className="text-xs text-muted">Conteúdo visual indisponível. O corpo pode não ter sido armazenado ou já estar fora da retenção do provedor. O resumo e os eventos continuam abaixo.</p>
                )}
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Eventos do provedor</h3>
                  {detail.events.length === 0 ? <p className="text-xs text-muted">Nenhum evento recebido ainda.</p> : (
                    <ul className="space-y-1 text-xs">
                      {detail.events.map((event) => (
                        <li key={event.id} className="flex justify-between gap-3">
                          <span className="text-fg">{event.event_type === 'proxy_open' ? 'Abertura por proxy (não conta como leitura)' : emailStatusMeta(event.event_type).label}</span>
                          <span className="text-muted">{formatDateTime(event.occurred_at)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
            <p className="flex items-center gap-1 text-xs text-muted"><Mail className="h-3 w-3" /> Abertura e clique são sinais auxiliares; resposta real é registrada pelo atendimento.</p>
          </div>
        )}
      </Modal>
    </Card>
  );
}
