import { createHash } from 'node:crypto';
import type { EmailEventType } from './email-campaign';
const events: Record<string, EmailEventType> = {
  request: 'sent', sent: 'sent', delivered: 'delivered', opened: 'opened', unique_opened: 'opened', click: 'clicked',
  soft_bounce: 'bounced', hard_bounce: 'bounced', invalid_email: 'bounced', spam: 'complained', unsubscribed: 'unsubscribed',
  deferred: 'deferred', blocked: 'blocked', error: 'error', proxy_open: 'proxy_open', unique_proxy_open: 'proxy_open',
};
export type BrevoEvent = { message_id: string; email: string; provider_type: string; event_type: EmailEventType | null; occurred_at: string; event_key: string };
export function normalizeBrevoEvent(input: unknown, now = Date.now()): BrevoEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event');
  const row = input as Record<string, unknown>;
  const type = typeof row.event === 'string' ? row.event.trim().toLowerCase() : '';
  const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
  const message = typeof row['message-id'] === 'string' ? row['message-id'].trim().replace(/^<|>$/g, '') : '';
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(type) || /[\x00-\x1f\x7f]/.test(email) || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !message || message.length > 1000 || /[\r\n\0]/.test(message)) throw new Error('Invalid event');
  // Provider timestamps are UTC. Never infer a timezone from Brevo's localized date string.
  const raw = row.ts_event ?? row.ts_epoch ?? row.ts;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const timestamp = value < 1e12 ? value * 1000 : value;
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2000, 0, 1) || timestamp > now + 300000) throw new Error('Invalid event time');
  const occurred = new Date(timestamp).toISOString();
  const link = typeof row.link === 'string' ? row.link : '';
  if (link.length > 8192) throw new Error('Invalid event link');
  // Brevo's id identifies the webhook, not an individual email event.
  const key = createHash('sha256').update(JSON.stringify([message, email, type, occurred, type === 'click' ? link : ''])).digest('hex');
  return { message_id: message, email, provider_type: type, event_type: events[type] ?? null, occurred_at: occurred, event_key: key };
}

// Brevo anonymizes some opens/clicks: no address and an `an#…` message id. They
// are attributed later by exact personalized subject (crm_apply_brevo_anonymized_events).
export type BrevoAnonymizedEvent = { subject: string; provider_type: string; event_type: 'opened' | 'clicked' | 'proxy_open'; occurred_at: string; event_key: string };
export function normalizeBrevoAnonymizedEvent(input: unknown, now = Date.now()): BrevoAnonymizedEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const email = typeof row.email === 'string' ? row.email.trim() : '';
  const message = typeof row['message-id'] === 'string' ? row['message-id'].trim() : '';
  const subject = typeof row.subject === 'string' ? row.subject.trim() : '';
  const type = typeof row.event === 'string' ? row.event.trim().toLowerCase() : '';
  const kind = events[type];
  if (email || !(message === '' || message.startsWith('an#')) || !subject || subject.length > 300
    || (kind !== 'opened' && kind !== 'clicked' && kind !== 'proxy_open')) return null;
  const raw = row.ts_event ?? row.ts_epoch ?? row.ts;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const timestamp = value < 1e12 ? value * 1000 : value;
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2000, 0, 1) || timestamp > now + 300000) return null;
  const occurred = new Date(timestamp).toISOString();
  const key = createHash('sha256').update(JSON.stringify(['anonymized', message, subject, type, occurred])).digest('hex');
  return { subject, provider_type: type, event_type: kind, occurred_at: occurred, event_key: key };
}
