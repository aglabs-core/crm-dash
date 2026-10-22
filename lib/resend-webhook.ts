import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { classifySystemEmail, systemEmailLedgerRecord } from './system-email-classifier';

// Resend signs webhooks with Svix: HMAC-SHA256 over `${id}.${timestamp}.${body}`
// using the base64 secret after the `whsec_` prefix. Raw body bytes matter, so
// the body is read as text before parsing.
export const MAX_RESEND_WEBHOOK_BYTES = 65536;
const TOLERANCE_SECONDS = 300;

export type ResendReceiverConfig = { secret: string; url: string; serviceKey: string; resendApiKey?: string };
export function resendReceiverConfig(): ResendReceiverConfig {
  return { secret: process.env.RESEND_WEBHOOK_SECRET || '', url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', resendApiKey: process.env.RESEND_API_KEY || undefined };
}
export function validResendConfig(config: ResendReceiverConfig) {
  return /^whsec_[A-Za-z0-9+/=]{24,}$/.test(config.secret) && /^https:\/\//.test(config.url) && !!config.serviceKey;
}

export function verifySvixSignature(secret: string, headers: Headers, body: string, now = Date.now()): boolean {
  const id = headers.get('svix-id') || ''; const timestamp = headers.get('svix-timestamp') || '';
  const signatures = headers.get('svix-signature') || '';
  if (!id || id.length > 200 || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'));
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',', 2);
    if (version !== 'v1' || !value) return false;
    const actual = Buffer.from(value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

const EVENT_TYPES: Record<string, string> = {
  'email.scheduled': 'scheduled', 'email.sent': 'accepted', 'email.delivered': 'delivered',
  'email.delivery_delayed': 'deferred', 'email.complained': 'complained', 'email.opened': 'opened',
  'email.clicked': 'clicked', 'email.failed': 'failed', 'email.suppressed': 'failed',
};

export type ResendLedgerEvent = {
  email_id: string; address: string; event_type: string; provider_event_type: string; event_key: string;
  occurred_at: string; record?: Record<string, unknown>;
};

/** Normalized ledger event, or null when the event is not about an e-mail we track. */
export function normalizeResendEvent(payload: unknown, eventKey: string, now = Date.now()): ResendLedgerEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid event');
  const row = payload as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  const type = typeof row.type === 'string' ? row.type : '';
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  let kind = EVENT_TYPES[type];
  if (type === 'email.bounced') {
    const bounce = (data.bounce && typeof data.bounce === 'object' ? data.bounce : {}) as { type?: unknown };
    kind = bounce.type === 'Permanent' ? 'bounced' : 'soft_bounced';
  }
  if (!kind) return null;
  const emailId = typeof data.email_id === 'string' ? data.email_id.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(emailId)) throw new Error('Invalid event');
  const to = Array.isArray(data.to) ? data.to : typeof data.to === 'string' ? [data.to] : [];
  // System e-mails have a single recipient; anything else is not CRM history.
  if (to.length !== 1 || typeof to[0] !== 'string') return null;
  const address = to[0].trim().toLowerCase();
  if (address.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  const occurredRaw = typeof row.created_at === 'string' ? row.created_at : '';
  const occurred = Date.parse(occurredRaw);
  if (!Number.isFinite(occurred) || occurred > now + 300000 || occurred < Date.UTC(2020, 0, 1)) throw new Error('Invalid event time');
  const sentRaw = typeof data.created_at === 'string' ? Date.parse(data.created_at) : NaN;
  const from = typeof data.from === 'string' ? data.from : '';
  const subject = typeof data.subject === 'string' ? data.subject : '';
  const classification = subject ? classifySystemEmail({ from, subject, tags: data.tags }) : null;
  const event: ResendLedgerEvent = {
    email_id: emailId, address, event_type: kind, provider_event_type: type, event_key: eventKey.slice(0, 200),
    occurred_at: new Date(occurred).toISOString(),
  };
  if (classification) {
    event.record = systemEmailLedgerRecord(classification, {
      subject, from, sent_at: new Date(Number.isFinite(sentRaw) ? sentRaw : occurred).toISOString(),
    });
  }
  return event;
}

async function readLimitedText(request: Request, limit: number): Promise<string> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new Error('413');
  const reader = request.body?.getReader(); if (!reader) throw new Error('400');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) { await reader.cancel(); throw new Error('413'); }
    parts.push(chunk.value);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** RFC Message-ID lets Maia match a reply to the exact e-mail. Optional: the backfill also fills it. */
export async function fetchResendMessageId(apiKey: string, emailId: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { id?: unknown; message_id?: unknown };
    return body.id === emailId && typeof body.message_id === 'string' && /^<[^<>\s]+@[^<>\s]+>$/.test(body.message_id)
      ? body.message_id : undefined;
  } catch {
    return undefined;
  }
}

const response = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function receiveResendWebhook(request: Request, dependencies?: {
  config: ResendReceiverConfig; ingest: (event: ResendLedgerEvent) => Promise<unknown>;
  messageId?: (emailId: string) => Promise<string | undefined>; now?: number;
}) {
  const config = dependencies?.config ?? resendReceiverConfig();
  if (!validResendConfig(config)) return response(503, { error: 'Receiver unavailable' });
  let body: string;
  try { body = await readLimitedText(request, MAX_RESEND_WEBHOOK_BYTES); } catch (error) {
    return response((error as Error).message === '413' ? 413 : 400, { error: 'Invalid body' });
  }
  if (!verifySvixSignature(config.secret, request.headers, body, dependencies?.now)) {
    // Never log headers, payload, addresses or the secret.
    console.warn('Resend webhook signature refused', { hasId: request.headers.has('svix-id'), hasSignature: request.headers.has('svix-signature') });
    return response(401, { error: 'Unauthorized' });
  }
  let event: ResendLedgerEvent | null;
  try {
    event = normalizeResendEvent(JSON.parse(body), request.headers.get('svix-id') || '', dependencies?.now);
  } catch {
    return response(400, { error: 'Invalid event' });
  }
  if (!event) return response(200, { status: 'ignored' });
  try {
    if (event.record && event.event_type === 'accepted') {
      const lookup = dependencies?.messageId ?? (config.resendApiKey ? (id: string) => fetchResendMessageId(config.resendApiKey!, id) : undefined);
      const rfc = lookup ? await lookup(event.email_id) : undefined;
      if (rfc) event.record = { ...event.record, rfc_message_id: rfc };
    }
    if (dependencies) await dependencies.ingest(event);
    else {
      const client = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
      const { error } = await client.rpc('crm_ingest_resend_event', { p: event });
      if (error) throw new Error('Persistence failed');
    }
    return response(200, { status: event.record ? 'recorded' : 'applied' });
  } catch {
    return response(503, { error: 'Persistence unavailable' });
  }
}
