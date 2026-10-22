import { createClient } from '@supabase/supabase-js';

type MessageContent = { provider: string; direction: string; provider_message_id: string; address: string;
  subject: string; body_html: string | null; body_text: string | null };
type ContentConfig = { url: string; anonKey: string; resendKey?: string };
const reply = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });

/** Read only: the user's JWT/RLS authorizes the message before any provider lookup. */
export async function getEmailContent(request: Request, id: string, dependencies?: {
  config: ContentConfig; read: (token: string, id: string) => Promise<MessageContent | null>;
  retrieve: (providerId: string) => Promise<unknown>;
}) {
  const token = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || token.length > 8192) return reply(401, { error: 'Unauthorized' });
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return reply(400, { error: 'Invalid message' });
  const config = dependencies?.config ?? { url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', resendKey: process.env.RESEND_API_KEY };
  if (!config.url || !config.anonKey) return reply(503, { error: 'Content unavailable' });
  try {
    let message: MessageContent | null;
    if (dependencies) message = await dependencies.read(token, id);
    else {
      const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` },
          fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) } });
      const { data: auth, error: authError } = await client.auth.getUser(token);
      if (authError || !auth.user) return reply(401, { error: 'Unauthorized' });
      const { data, error } = await client.from('email_messages')
        .select('provider,direction,provider_message_id,address,subject,body_html,body_text').eq('id', id).maybeSingle();
      if (error) throw new Error('Read unavailable');
      message = data as MessageContent | null;
    }
    if (!message) return reply(404, { error: 'Message unavailable' });
    if (message.body_html || message.body_text) return reply(200, { body_html: message.body_html, body_text: message.body_text, source: 'stored' });
    if (message.provider !== 'resend' || message.direction !== 'outbound' || !config.resendKey) {
      return reply(200, { body_html: null, body_text: null, reason: 'not_stored' });
    }
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(message.provider_message_id)) return reply(404, { error: 'Message unavailable' });
    let raw: unknown;
    if (dependencies) raw = await dependencies.retrieve(message.provider_message_id);
    else {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(message.provider_message_id)}`, {
        headers: { Authorization: `Bearer ${config.resendKey}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404 || res.status === 410) return reply(200, { body_html: null, body_text: null, reason: 'provider_unavailable' });
      if (!res.ok) throw new Error('Provider unavailable');
      // Bound provider content before parsing; don't buffer arbitrary response sizes.
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Provider unavailable');
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1000000) { await reader.cancel(); throw new Error('Content too large'); }
        chunks.push(chunk.value);
      }
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const body = raw as { id?: unknown; to?: unknown; subject?: unknown; html?: unknown; text?: unknown };
    if (!body || body.id !== message.provider_message_id || body.subject !== message.subject
      || !Array.isArray(body.to) || body.to.length !== 1 || typeof body.to[0] !== 'string'
      || body.to[0].trim().toLowerCase() !== message.address.trim().toLowerCase()) return reply(404, { error: 'Message unavailable' });
    const html = typeof body.html === 'string' && body.html.length <= 200000 ? body.html : null;
    const text = typeof body.text === 'string' && body.text.length <= 200000 ? body.text : null;
    return reply(200, { body_html: html, body_text: text, source: 'resend', ...(!html && !text ? { reason: 'provider_unavailable' } : {}) });
  } catch {
    // No payload, recipient, body or provider response in logs/errors.
    return reply(503, { error: 'Content unavailable' });
  }
}
