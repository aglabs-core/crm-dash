import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { normalizeBrevoEvent, type BrevoEvent } from './brevo-events';
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
}) {
  const config = dependencies?.config ?? receiverConfig();
  if (!validReceiverConfig(config)) return response(503, { error: 'Receiver unavailable' });
  const expected = Buffer.from(`Bearer ${config.token}`); const actual = Buffer.from(request.headers.get('authorization') || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    // Shape only: never log the header, token, payload, address or a credential hash.
    console.warn('Brevo webhook authentication refused', {
      headerPresent: actual.length > 0,
      bearerScheme: /^Bearer /i.test(actual.toString()),
      headerLength: actual.length,
      expectedLength: expected.length,
    });
    return response(401, { error: 'Unauthorized' });
  }
  let normalized: BrevoEvent[];
  try {
    const body = await readLimitedJson(request); const batch = Array.isArray(body) ? body : [body];
    if (!batch.length || batch.length > 100) return response(400, { error: 'Invalid batch' });
    normalized = batch.map((event) => normalizeBrevoEvent(event));
  } catch (error) {
    const code = (error as Error).message;
    return response(code === '413' ? 413 : code === '415' ? 415 : 400, { error: 'Invalid event body' });
  }
  try {
    if (dependencies) await dependencies.ingest(normalized);
    else {
      const { error } = await serviceClient(config).rpc('ingest_brevo_events', { p_connection_id: config.connectionId, p_events: normalized });
      if (error) throw new Error('Persistence failed');
    }
    return response(200, { accepted: normalized.length });
  } catch {
    // No payload, recipient, token or provider response is written to logs.
    return response(503, { error: 'Persistence unavailable' });
  }
}
