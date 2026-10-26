import { projectCommerceFunnel, type CommerceFunnel } from './commerce-funnel';
import { projectMarketplace, type Marketplace } from './marketplace';
import { projectCredits, type Credits } from './credits';
// Business metrics are collected by the CRM; the application remains authoritative.
const keys = ['users', 'accounts', 'activeAccounts', 'trialAccounts', 'payingAccounts', 'complimentaryAccounts', 'canceledAccounts', 'activatedAccounts'] as const;
type Metric = typeof keys[number];
const origins: Record<string, { hosts: string[]; path: string }> = {
  barberias: { hosts: ['barberias.com.br', 'www.barberias.com.br'], path: '/api/integrations/orbita/metrics' },
  mecard: { hosts: ['mecard.com.br', 'www.mecard.com.br'], path: '/api/integrations/crm/metrics' },
  members: { hosts: ['members.ia.br', 'www.members.ia.br'], path: '/api/integrations/crm/metrics' },
  'aglabs-app': { hosts: ['aglabs.app.br', 'www.aglabs.app.br'], path: '/api/integrations/crm/metrics' },
  vibekit: { hosts: ['templates.aglabs.ia.br'], path: '/api/integrations/crm/metrics' },
};
export type ActivationFunnel = { professional: number; catalog: number; readyForBooking: number; firstAppointment: number };
export type ProductSnapshot = { version: 1; product: string; generatedAt: string; window: { from: string; to: string }; metrics: Record<Metric, number | null>; activationFunnel?: ActivationFunnel; commerceFunnel?: CommerceFunnel; marketplace?: Marketplace; credits?: Credits };
export type ProductMetricsResult = { status: 'ok' | 'stale' | 'not_configured' | 'unavailable'; checkedAt: string; data: ProductSnapshot | null; message: string; via: 'crm' };

export function validateSnapshot(raw: unknown, product: string, now = Date.now()): ProductSnapshot {
  const value = raw as ProductSnapshot;
  const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v) && Number.isFinite(Date.parse(v));
  if (!value || value.version !== 1 || value.product !== product || !date(value.generatedAt) || !date(value.window?.from) || !date(value.window?.to) || Date.parse(value.window.from) > Date.parse(value.window.to) || Date.parse(value.generatedAt) > now + 300_000 || Date.parse(value.window.to) > now + 300_000) throw new Error('Snapshot inválido');
  const metrics = {} as ProductSnapshot['metrics'];
  for (const key of keys) {
    const count = value.metrics?.[key];
    if (count !== null && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) throw new Error('Contagem inválida');
    metrics[key] = count;
  }
  let activationFunnel: ActivationFunnel | undefined;
  if (product === 'barberias' && value.activationFunnel !== undefined) {
    const funnel = value.activationFunnel;
    const ordered = [metrics.accounts, funnel?.professional, funnel?.catalog, funnel?.readyForBooking, funnel?.firstAppointment];
    if (ordered.some(v => typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
      || ordered.some((v, i) => i > 0 && v! > ordered[i - 1]!)
      || funnel.firstAppointment !== metrics.activatedAccounts) throw new Error('Funil inválido');
    activationFunnel = { professional: funnel.professional, catalog: funnel.catalog, readyForBooking: funnel.readyForBooking, firstAppointment: funnel.firstAppointment };
  }
  let commerceFunnel: CommerceFunnel | undefined;
  if (product === 'vibekit') {
    if (Object.values(metrics).some(n => n !== null) || Date.parse(value.window.to) > Date.parse(value.generatedAt)) throw new Error('Unidade comercial inválida');
    commerceFunnel = projectCommerceFunnel(value.commerceFunnel, value.window.to);
  }
  let marketplace: Marketplace | undefined;
  if (product === 'members') {
    // Marketplace não tem conta SaaS: só users é aceito no contrato v1; o resto vai no bloco próprio.
    if (Object.entries(metrics).some(([key, n]) => key !== 'users' && n !== null)) throw new Error('Unidade de marketplace inválida');
    if (value.marketplace !== undefined) {
      if (Date.parse(value.window.to) > Date.parse(value.generatedAt)) throw new Error('Geração divergente da janela');
      marketplace = projectMarketplace(value.marketplace, value.window);
      if (metrics.users !== marketplace.users.total) throw new Error('Usuários divergentes');
    }
  }
  let credits: Credits | undefined;
  if (product === 'aglabs-app') {
    // Modelo de créditos: só users no contrato v1; o resto vai no bloco próprio.
    if (Object.entries(metrics).some(([key, n]) => key !== 'users' && n !== null)) throw new Error('Unidade de créditos inválida');
    if (value.credits !== undefined) {
      credits = projectCredits(value.credits);
      if (metrics.users !== credits.users.total || Date.parse(value.window.to) > Date.parse(value.generatedAt)) throw new Error('Créditos divergentes');
    }
  }
  // Explicit projection prevents accidental transmission of identities or provider secrets.
  return { version: 1, product, generatedAt: value.generatedAt, window: { from: value.window.from, to: value.window.to }, metrics, ...(activationFunnel ? { activationFunnel } : {}), ...(commerceFunnel ? { commerceFunnel } : {}), ...(marketplace ? { marketplace } : {}), ...(credits ? { credits } : {}) };
}

async function boundedJson(response: Response): Promise<unknown> {
  const max = 32 * 1024;
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Resposta excedida'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Resposta vazia');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error('Resposta excedida'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function productMetrics(product: string): Promise<ProductMetricsResult> {
  const checkedAt = new Date().toISOString();
  const result = (status: ProductMetricsResult['status'], message: string, data: ProductSnapshot | null = null): ProductMetricsResult => ({ status, message, data, checkedAt, via: 'crm' });
  try {
    if (!/^[a-z0-9][a-z0-9_-]{1,59}$/.test(product)) return result('unavailable', 'Produto inválido.');
    const config: unknown = JSON.parse(process.env.APP_METRICS_SOURCES || '[]');
    if (!Array.isArray(config)) throw new Error('Configuração inválida');
    const source = config.find((row: unknown) => row && typeof row === 'object' && 'product' in row && row.product === product) as { url?: unknown; token?: unknown } | undefined;
    if (!source) return result('not_configured', 'Coleta administrativa ainda não configurada no CRM.');
    if (typeof source.url !== 'string' || typeof source.token !== 'string' || source.token.length < 32) throw new Error('Configuração inválida');
    const url = new URL(source.url);
    const origin = origins[product];
    if (!origin || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !origin.hosts.includes(url.hostname) || url.pathname !== origin.path) throw new Error('Destino inválido');
    const response = await fetch(url, { headers: { authorization: `Bearer ${source.token}`, accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Origem indisponível');
    const snapshot = validateSnapshot(await boundedJson(response), product);
    return Date.now() - Date.parse(snapshot.generatedAt) > 24 * 3_600_000 ? result('stale', 'Snapshot do aplicativo há mais de 24 horas.', snapshot) : result('ok', 'Agregados do aplicativo consultados pelo CRM.', snapshot);
  } catch { return result('unavailable', 'Não foi possível consultar os agregados do aplicativo. Nenhum zero foi presumido.'); }
}
