import { createClient } from '@supabase/supabase-js';
import { productMetrics, type ProductMetricsResult } from './product-metrics';
export const ECOSYSTEM_PRODUCTS = ['barberias', 'mecard', 'members', 'vibekit', 'aglabs-app'] as const;
const reply = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
/** Product-wide aggregates require administrator membership, not merely a valid CRM login. */
export async function ecosystemOverview(request: Request, dependencies?: {
  authorize: (token: string) => Promise<boolean>; metrics: (product: string) => Promise<ProductMetricsResult>;
}) {
  const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!token || token.length > 8192) return reply(401, { error: 'unauthorized' });
  try {
    let allowed: boolean;
    if (dependencies) allowed = await dependencies.authorize(token);
    else {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return reply(503, { error: 'unavailable' });
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
      });
      const { data: auth, error: authError } = await client.auth.getUser(token);
      if (authError || !auth.user) return reply(401, { error: 'unauthorized' });
      const { data, error } = await client.from('admin_users').select('id').eq('id', auth.user.id).maybeSingle();
      if (error) throw new Error('membership unavailable');
      allowed = Boolean(data);
    }
    if (!allowed) return reply(403, { error: 'forbidden' });
    const products = await Promise.all(ECOSYSTEM_PRODUCTS.map(async product => ({ product, ...await (dependencies?.metrics ?? productMetrics)(product) })));
    return reply(200, { checkedAt: new Date().toISOString(), products });
  } catch { return reply(503, { error: 'ecosystem_unavailable' }); }
}
