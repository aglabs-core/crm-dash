import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readLimitedJson } from './brevo-receiver';
import { accountReceiverConfig, type AccountReceiverConfig } from './account-events';

// Feedback enviado pelos apps (botão "Enviar feedback"). O backend do produto
// chama POST /api/integrations/feedback com o mesmo token dos eventos de conta
// (ACCOUNT_EVENTS_TOKEN). O CRM liga ao contato pelo e-mail sem criar lead e
// expõe a fila pelo MCP (crm_feedback), sem e-mail nem telefone.
export type ProductFeedbackEvent = {
  event_key: string; event: 'feedback.submitted'; occurred_at: string; product: string;
  account_ref: string | null; owner_email: string | null; message: string; pathname: string | null;
};

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

export function normalizeFeedbackEvent(input: unknown, now = Date.now()): ProductFeedbackEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid event');
  const row = input as Record<string, unknown>;
  if (row.event !== 'feedback.submitted') throw new Error('Invalid event');
  const product = text(row.product, 40)?.toLowerCase();
  const key = text(row.event_key, 200);
  const message = text(row.message, 2000);
  const email = text(row.owner_email, 320)?.toLowerCase() ?? null;
  const at = typeof row.occurred_at === 'string' ? Date.parse(row.occurred_at) : NaN;
  if (!product || !/^[a-z0-9-]{2,40}$/.test(product) || !key || !message || message.length < 3
    || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || !Number.isFinite(at) || at > now + 300000 || at < Date.UTC(2020, 0, 1)) throw new Error('Invalid event');
  // Só o caminho da tela: query string pode carregar dado pessoal.
  const rawPath = typeof row.pathname === 'string' ? row.pathname.trim().split(/[?#]/)[0] : '';
  return {
    event_key: `${product}:feedback:${key}`, event: 'feedback.submitted', occurred_at: new Date(at).toISOString(), product,
    account_ref: text(row.account_ref, 200), owner_email: email, message,
    pathname: rawPath.startsWith('/') && rawPath.length <= 200 ? rawPath : null,
  };
}

const response = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function receiveFeedbackEvent(request: Request, dependencies?: {
  config: AccountReceiverConfig; ingest: (event: ProductFeedbackEvent) => Promise<unknown>;
}) {
  const config = dependencies?.config ?? accountReceiverConfig();
  if (config.token.length < 32 || !/^https:\/\//.test(config.url) || !config.serviceKey) return response(503, { error: 'Receiver unavailable' });
  const match = /^Bearer[ \t]+(\S+)$/i.exec(request.headers.get('authorization') || '');
  const expected = Buffer.from(config.token); const actual = Buffer.from(match?.[1] || '');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return response(401, { error: 'Unauthorized' });
  let event: ProductFeedbackEvent;
  try { event = normalizeFeedbackEvent(await readLimitedJson(request)); } catch (error) {
    const code = (error as Error).message;
    return response(code === '413' ? 413 : code === '415' ? 415 : 400, { error: 'Invalid event' });
  }
  try {
    if (dependencies) await dependencies.ingest(event);
    else {
      const client = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } });
      const { error } = await client.rpc('crm_ingest_product_feedback', { p: event });
      if (error) throw new Error('Persistence failed');
    }
    return response(200, { accepted: true });
  } catch {
    return response(503, { error: 'Persistence unavailable' });
  }
}
