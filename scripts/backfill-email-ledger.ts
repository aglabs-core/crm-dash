// One-off/idempotent backfill of the unified e-mail ledger. Sends nothing.
//
//   tsx scripts/backfill-email-ledger.ts resend [--apply]
//   tsx scripts/backfill-email-ledger.ts brevo <manifest.json> [--apply]
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (resend mode),
// BREVO_API_KEY + BREVO_CONNECTION_ID (brevo mode), optional
// BACKFILL_SKIP_ADDRESSES (comma-separated internal/test addresses).
// Without --apply it only reports counts. It never prints addresses or bodies.
import { readFile } from 'node:fs/promises';
import { classifySystemEmail, systemEmailLedgerRecord } from '../lib/system-email-classifier';
import { normalizeBrevoAnonymizedEvent, normalizeBrevoEvent } from '../lib/brevo-events';

const apply = process.argv.includes('--apply');
const env = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const skip = new Set((process.env.BACKFILL_SKIP_ADDRESSES || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean));

async function rest(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, { ...init, headers: {
    apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path.split('?')[0]} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: object) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

// Resend list dates look like "2026-10-21 23:51:45.13+00".
const iso = (value: string) => new Date(value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
const RESEND_LAST: Record<string, string> = { delivered: 'delivered', opened: 'opened', clicked: 'clicked', bounced: 'bounced',
  complained: 'complained', delivery_delayed: 'deferred', failed: 'failed' };

async function backfillResend() {
  const key = env('RESEND_API_KEY'); const rows: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (;;) {
    const response = await fetch(`https://api.resend.com/emails?limit=100${after ? `&after=${after}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`Resend list HTTP ${response.status}`);
    const page = await response.json() as { data: Record<string, unknown>[]; has_more: boolean };
    rows.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    after = String(page.data[page.data.length - 1].id);
  }
  const counts: Record<string, number> = {};
  for (const row of rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const to = Array.isArray(row.to) ? row.to : [];
    const address = typeof to[0] === 'string' ? to[0].toLowerCase() : '';
    const record = to.length === 1 ? classifySystemEmail({ from: String(row.from || ''), subject: String(row.subject || '') }) : null;
    if (!record) { counts.ignored = (counts.ignored || 0) + 1; continue; }
    if (skip.has(address)) { counts.skipped_internal = (counts.skipped_internal || 0) + 1; continue; }
    counts[record.source_key] = (counts[record.source_key] || 0) + 1;
    if (!apply) continue;
    const sentAt = iso(String(row.created_at));
    const replyTo = Array.isArray(row.reply_to) ? String(row.reply_to[0] || '') : row.reply_to ? String(row.reply_to) : null;
    const ledger = systemEmailLedgerRecord(record, { subject: String(row.subject), from: String(row.from), reply_to: replyTo, sent_at: sentAt,
      rfc_message_id: typeof row.message_id === 'string' ? row.message_id : null });
    const base = { email_id: String(row.id), address, occurred_at: sentAt, record: ledger };
    await rpc('crm_ingest_resend_event', { p: { ...base, event_type: 'accepted', provider_event_type: 'backfill.sent', event_key: `backfill:sent:${row.id}` } });
    const last = RESEND_LAST[String(row.last_event)];
    // The list only exposes the latest event, without its time: recorded at send time and labeled as backfill.
    if (last) await rpc('crm_ingest_resend_event', { p: { ...base, event_type: last, provider_event_type: `backfill.last_event.${row.last_event}`, event_key: `backfill:last:${row.id}:${row.last_event}` } });
  }
  console.log(JSON.stringify({ mode: 'resend', apply, total: rows.length, counts }));
}

type ManifestMessage = { email: string; contact_id?: string; message_id: string; subject: string; sent_at: string;
  html?: string; text?: string; summary: string; review_note: string; from?: string; reply_to?: string };
type Manifest = { lots: { campaign: { name: string; product: string; sender_email: string; subject: string; source_key: string; reply_to?: string };
  category?: 'prospeccao' | 'campanha' | 'atendimento'; messages: ManifestMessage[] }[] };

// Brevo statistics API names → webhook event names used by normalizeBrevoEvent.
const BREVO_API: Record<string, string> = { requests: 'request', delivered: 'delivered', opened: 'opened', clicks: 'click',
  softBounces: 'soft_bounce', hardBounces: 'hard_bounce', deferred: 'deferred', loadedByProxy: 'proxy_open',
  unsubscribed: 'unsubscribed', spam: 'spam', blocked: 'blocked', error: 'error', invalid: 'invalid_email' };

async function brevoEvents(params: Record<string, string>) {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 2500) {
    const query = new URLSearchParams({ ...params, limit: '2500', offset: String(offset), sort: 'asc' });
    const response = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${query}`, { headers: { 'api-key': env('BREVO_API_KEY'), accept: 'application/json' } });
    if (!response.ok) throw new Error(`Brevo events HTTP ${response.status}`);
    const page = await response.json() as { events?: Record<string, unknown>[] };
    out.push(...(page.events || []));
    if ((page.events || []).length < 2500) break;
  }
  return out;
}
const webhookShape = (event: Record<string, unknown>) => ({ event: BREVO_API[String(event.event)] || String(event.event),
  email: String(event.email || ''), 'message-id': String(event.messageId || ''), subject: event.subject,
  ts_event: Math.floor(Date.parse(String(event.date)) / 1000) });

async function backfillBrevo(path: string) {
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
  const connection = env('BREVO_CONNECTION_ID');
  const counts = { campaigns: 0, messages: 0, events: 0, anonymized: 0 };
  const subjects = new Set<string>(); let firstSent = '9999';
  // Campaigns belong to the owner of the Brevo connection that receives their events.
  const owner = apply ? String((await rest(`email_provider_connections?select=user_id&id=eq.${connection}`))[0]?.user_id || '') : '';
  if (apply && !owner) throw new Error('Brevo connection not found');
  for (const lot of manifest.lots) {
    counts.campaigns++;
    let campaignId: string | undefined;
    if (apply) {
      const found = await rest(`email_campaigns?select=id&name=eq.${encodeURIComponent(lot.campaign.name)}&limit=1`);
      campaignId = found[0]?.id ?? (await rest('email_campaigns', { method: 'POST', body: JSON.stringify({ user_id: owner, name: lot.campaign.name,
        product: lot.campaign.product, provider: 'brevo', sender_email: lot.campaign.sender_email, subject: lot.campaign.subject,
        audience_basis: 'individual_review', status: 'completed', reply_to: lot.campaign.reply_to ?? null }) }))[0].id;
    }
    for (const message of lot.messages) {
      counts.messages++; subjects.add(message.subject); if (message.sent_at < firstSent) firstSent = message.sent_at;
      if (!apply) continue;
      const email = message.email.toLowerCase();
      const contact = message.contact_id ?? (await rest(`contacts?select=id&email=ilike.${encodeURIComponent(email)}&order=created_at.asc&limit=1`))[0]?.id;
      if (!contact) throw new Error('Contact not found for a manifest message');
      const existing = await rest(`email_campaign_recipients?select=id&campaign_id=eq.${campaignId}&contact_id=eq.${contact}&limit=1`);
      const recipient = existing[0]?.id ?? (await rest('email_campaign_recipients', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId,
        user_id: owner, contact_id: contact, email_snapshot: email, review_note: message.review_note.slice(0, 1000),
        provider_message_id: message.message_id.replace(/^<|>$/g, '') }) }))[0].id;
      await rpc('crm_record_outbound_email', { p: { provider: 'brevo', provider_message_id: message.message_id, category: lot.category ?? 'prospeccao',
        source_key: lot.campaign.source_key, product: lot.campaign.product, campaign_id: campaignId, recipient_id: recipient, contact_id: contact,
        address: email, from_address: message.from ?? lot.campaign.sender_email, reply_to: message.reply_to ?? lot.campaign.reply_to ?? null,
        subject: message.subject, summary: message.summary, body_html: message.html ?? null, body_text: message.text ?? null, sent_at: message.sent_at } });
      const events = (await brevoEvents({ messageId: message.message_id, days: '90' }))
        .filter((event) => event.email).map((event) => normalizeBrevoEvent(webhookShape(event)));
      for (let i = 0; i < events.length; i += 100) await rpc('ingest_brevo_events', { p_connection_id: connection, p_events: events.slice(i, i + 100) });
      counts.events += events.length;
    }
  }
  // Anonymized opens/clicks have no message id: attribute by the exact personalized subject.
  if (apply && counts.messages) {
    const start = firstSent.slice(0, 10); const end = new Date().toISOString().slice(0, 10);
    const anonymous = (await brevoEvents({ startDate: start, endDate: end }))
      .filter((event) => !event.email && subjects.has(String(event.subject || '').trim()))
      .map((event) => normalizeBrevoAnonymizedEvent(webhookShape(event))).filter((event) => event !== null);
    for (let i = 0; i < anonymous.length; i += 100) {
      counts.anonymized += Number(await rpc('crm_apply_brevo_anonymized_events', { p_connection_id: connection, p_events: anonymous.slice(i, i + 100) }));
    }
  }
  console.log(JSON.stringify({ mode: 'brevo', apply, counts }));
}

const mode = process.argv[2];
(mode === 'resend' ? backfillResend() : mode === 'brevo' ? backfillBrevo(process.argv[3]) : Promise.reject(new Error('Usage: resend|brevo <manifest>')))
  .catch((error) => { console.error(String(error.message || error)); process.exit(1); });
