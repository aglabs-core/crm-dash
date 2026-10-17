import { createClient } from '@supabase/supabase-js';
import { readLimitedJson, receiverConfig, serviceClient, validReceiverConfig, type ReceiverConfig } from './brevo-receiver';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const response = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function associateBrevoMessage(request: Request, dependencies?: {
  config: ReceiverConfig; authenticate: (token: string) => Promise<string | null>;
  associate: (actor: string, recipient: string, message: string) => Promise<number>;
}) {
  const config = dependencies?.config ?? receiverConfig();
  if (!validReceiverConfig(config)) return response(503, { error: 'Integration unavailable' });
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 8192) return response(401, { error: 'Unauthorized' });
  try {
    const token = header.slice(7);
    let actor: string | null;
    if (dependencies) actor = await dependencies.authenticate(token);
    else {
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anon) return response(503, { error: 'Integration unavailable' });
      const client = createClient(config.url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.getUser(token);
      actor = error ? null : data.user?.id || null;
    }
    if (!actor) return response(401, { error: 'Unauthorized' });
    const body = await readLimitedJson(request) as Record<string, unknown>;
    const recipient = body?.recipient_id; const message = typeof body?.message_id === 'string' ? body.message_id.trim().replace(/^<|>$/g, '') : '';
    if (typeof recipient !== 'string' || !uuid.test(recipient) || !message || message.length > 1000 || /[\r\n\0]/.test(message)) return response(400, { error: 'Invalid association' });
    let matched: number;
    if (dependencies) matched = await dependencies.associate(actor, recipient, message);
    else {
      const { data, error } = await serviceClient(config).rpc('associate_brevo_message', {
        p_connection_id: config.connectionId, p_actor_id: actor, p_recipient_id: recipient, p_message_id: message,
      });
      if (error) return response(409, { error: 'Association unavailable' });
      matched = Number(data) || 0;
    }
    return response(200, { matched });
  } catch {
    return response(409, { error: 'Association unavailable' });
  }
}
