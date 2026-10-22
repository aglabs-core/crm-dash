import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readLimitedJson } from './brevo-receiver';

// Product backends (Barberias) report the account lifecycle here: sign-up,
// onboarding, first booking, trial end and subscription changes. Each event
// updates the owner's contact and adds one line to the timeline.
export const ACCOUNT_EVENTS = ['account.created', 'trial.started', 'onboarding.completed', 'first_appointment',
  'trial.ended', 'subscription.active', 'subscription.canceled'] as const;
export type AccountEventName = typeof ACCOUNT_EVENTS[number];
export type AccountEvent = {
  event_key: string; event: AccountEventName; occurred_at: string; product: string;
  account_ref: string; account_name: string | null; owner_email: string; owner_name: string | null;
};
export type AccountReceiverConfig = { token: string; url: string; serviceKey: string };
export function accountReceiverConfig(): AccountReceiverConfig {
  return { token: process.env.ACCOUNT_EVENTS_TOKEN || '', url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
}

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

export function normalizeAccountEvent(input: unknown, now = Date.now()): AccountEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event');
  const row = input as Record<string, unknown>;
  const event = row.event as AccountEventName;
  if (!ACCOUNT_EVENTS.includes(event)) throw new Error('Invalid event');
  const product = text(row.product, 40)?.toLowerCase();
  const ref = text(row.account_ref, 200); const key = text(row.event_key, 200);
  const email = text(row.owner_email, 320)?.toLowerCase();
  const at = typeof row.occurred_at === 'string' ? Date.parse(row.occurred_at) : NaN;
  if (!product || !/^[a-z0-9-]+$/.test(product) || !ref || !key || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !Number.isFinite(at) || at > now + 300000 || at < Date.UTC(2020, 0, 1)) throw new Error('Invalid event');
  return { event_key: `${product}:${key}`, event, occurred_at: new Date(at).toISOString(), product, account_ref: ref,
    account_name: text(row.account_name, 120), owner_email: email, owner_name: text(row.owner_name, 120) };
}

const response = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function receiveAccountEvent(request: Request, dependencies?: {
  config: AccountReceiverConfig; ingest: (event: AccountEvent) => Promise<unknown>;
}) {
  const config = dependencies?.config ?? accountReceiverConfig();
  if (config.token.length < 32 || !/^https:\/\//.test(config.url) || !config.serviceKey) return response(503, { error: 'Receiver unavailable' });
  const match = /^Bearer[ \t]+(\S+)$/i.exec(request.headers.get('authorization') || '');
  const expected = Buffer.from(config.token); const actual = Buffer.from(match?.[1] || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response(401, { error: 'Unauthorized' });
  let event: AccountEvent;
  try { event = normalizeAccountEvent(await readLimitedJson(request)); } catch (error) {
    const code = (error as Error).message;
    return response(code === '413' ? 413 : code === '415' ? 415 : 400, { error: 'Invalid event' });
  }
  try {
    if (dependencies) await dependencies.ingest(event);
    else {
      const client = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
      const { error } = await client.rpc('crm_ingest_account_event', { p: event });
      if (error) throw new Error('Persistence failed');
    }
    return response(200, { accepted: true });
  } catch {
    return response(503, { error: 'Persistence unavailable' });
  }
}
