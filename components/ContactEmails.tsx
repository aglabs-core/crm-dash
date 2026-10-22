'use client';

import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  emailCategoryLabel, emailSourceLabel, emailStatusMeta, type EmailMessage, type EmailMessageEvent,
} from '@/lib/email-ledger';
import { Badge, Card, CardBody, CardHeader, CardTitle, Modal } from '@/components/ui';

const LIST_COLUMNS = 'id,contact_id,direction,provider,category,source_key,product,campaign_id,address,from_address,reply_to,subject,summary,status,sent_at,status_at,delivered_at,opened_at,clicked_at,replied_at,bounced_at';

/** Every e-mail sent to or received from this contact, with the provider's latest status. */
export function ContactEmails({ contactId }: { contactId: string }) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [detail, setDetail] = useState<{ body_html: string | null; body_text: string | null; events: EmailMessageEvent[] } | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from('email_messages').select(LIST_COLUMNS).eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setState('unavailable');
        else { setMessages((data ?? []) as EmailMessage[]); setState('ready'); }
      });
    return () => { active = false; };
  }, [contactId]);

  const open = async (message: EmailMessage) => {
    setSelected(message); setDetail(null);
    const [body, events] = await Promise.all([
      supabase.from('email_messages').select('body_html,body_text').eq('id', message.id).maybeSingle(),
      supabase.from('email_message_events').select('id,message_id,event_type,provider_event_type,occurred_at')
        .eq('message_id', message.id).order('occurred_at', { ascending: true }),
    ]);
    setDetail({ body_html: body.data?.body_html ?? null, body_text: body.data?.body_text ?? null,
      events: (events.data ?? []) as EmailMessageEvent[] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mails</CardTitle>
        <span className="text-sm text-muted">{state === 'ready' ? messages.length : ''}</span>
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
            {!detail ? <p className="text-muted">Carregando conteúdo…</p> : (
              <>
                {detail.body_html ? (
                  // Sandboxed with no permissions: no scripts, forms or same-origin access.
                  <iframe title="Prévia do e-mail" sandbox="" srcDoc={detail.body_html}
                    className="h-[420px] w-full rounded-lg border border-border bg-white" />
                ) : detail.body_text ? (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-border p-3 text-xs text-fg">{detail.body_text}</pre>
                ) : (
                  <p className="text-xs text-muted">Conteúdo não armazenado: e-mails automáticos do sistema guardam apenas o resumo da etapa.</p>
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
