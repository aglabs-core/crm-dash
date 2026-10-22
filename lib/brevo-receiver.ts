import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizeBrevoAnonymizedEvent, normalizeBrevoEvent, type BrevoAnonymizedEvent, type BrevoEvent } from './brevo-events';
export const MAX_WEBHOOK_BYTES = 131072;
export type ReceiverConfig = { token: string; connectionId: string; url: string; serviceKey: string };
export function receiverConfig(): ReceiverConfig {
  return { token: process.env.BREVO_WEBHOOK_TOKEN || '', connectionId: (process.env.BREVO_WEBHOOK_CONNECTION_ID || '').toLowerCase(),
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '', serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
}
export function serviceClient(config: ReceiverConfig) {
  return createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
}
export function validReceiverConfig(config: ReceiverConfig) {
  return config.token.length >= 32 && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(config.connectionId) && /^https:\/\//.test(config.url) && !!config.serviceKey;
}
export async function readLimitedJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('415');
  if (Number(request.headers.get('content-length') || 0) > MAX_WEBHOOK_BYTES) throw new Error('413');
  const reader = request.body?.getReader(); if (!reader) throw new Error('400');
  const parts: Uint8Array[] = []; let size = 0;
  for (;;) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); throw new Error('413'); }
    parts.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('400'); }
}
const response = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function receiveBrevoWebhook(request: Request, dependencies?: {
  config: ReceiverConfig; ingest: (events: BrevoEvent[]) => Promise<unknown>;
  ingestAnonymized?: (events: BrevoAnonymizedEvent[]) => Promise<unknown>;
}) {
  const config = dependencies?.config ?? receiverConfig();
  if (!validReceiverConfig(config)) return response(503, { error: 'Receiver unavailable' });
  // HTTP authentication schemes are case-insensitive; the secret itself is not.
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header);
  const expected = Buffer.from(config.token); const actual = Buffer.from(match?.[1] || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    // Shape only: never log the header, token, payload, address or a credential hash.
    console.warn('Brevo webhook authentication refused', {
      headerPresent: header.length > 0,
      bearerScheme: !!match,
      headerLength: header.length,
      expectedLength: expected.length + 7,
    });
    return response(401, { error: 'Unauthorized' });
  }
  const normalized: BrevoEvent[] = []; const anonymized: BrevoAnonymizedEvent[] = [];
  try {
    const body = await readLimitedJson(request); const batch = Array.isArray(body) ? body : [body];
    if (!batch.length || batch.length > 100) return response(400, { error: 'Invalid batch' });
    for (const event of batch) {
      const anonymous = normalizeBrevoAnonymizedEvent(event);
      if (anonymous) anonymized.push(anonymous); else normalized.push(normalizeBrevoEvent(event));
    }
  } catch (error) {
    const code = (error as Error).message;
    return response(code === '413' ? 413 : code === '415' ? 415 : 400, { error: 'Invalid event body' });
  }
  try {
    if (dependencies) {
      if (normalized.length) await dependencies.ingest(normalized);
      if (anonymized.length && dependencies.ingestAnonymized) await dependencies.ingestAnonymized(anonymized);
    } else {
      const client = serviceClient(config);
      if (normalized.length) {
        const { error } = await client.rpc('ingest_brevo_events', { p_connection_id: config.connectionId, p_events: normalized });
        if (error) throw new Error('Persistence failed');
      }
      // Anonymized opens/clicks used to fail the whole request with 400.
      if (anonymized.length) {
        const { error } = await client.rpc('crm_apply_brevo_anonymized_events', { p_connection_id: config.connectionId, p_events: anonymized });
        if (error) throw new Error('Persistence failed');
      }
    }
    return response(200, { accepted: normalized.length + anonymized.length });
  } catch {
    // No payload, recipient, token or provider response is written to logs.
    return response(503, { error: 'Persistence unavailable' });
  }
}
