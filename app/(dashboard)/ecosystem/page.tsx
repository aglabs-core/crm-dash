'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { productLabel } from '@/lib/product-label';
import type { ProductMetricsResult } from '@/lib/product-metrics';
import { Button, PageLoader } from '@/components/ui';
import { ActivationFunnel } from '@/components/activation-funnel';
import { CommerceFunnel } from '@/components/commerce-funnel';
import { MarketplaceSummary } from '@/components/marketplace-summary';
import { CreditsSummary } from '@/components/credits-summary';
type Product = ProductMetricsResult & { product: string };
const names = { users: 'Usuários registrados', accounts: 'Contas', activeAccounts: 'Contas com acesso', trialAccounts: 'Em teste', payingAccounts: 'Assinaturas com acesso', activatedAccounts: 'Contas ativadas' } as const;
const statuses = { ok: 'Coleta disponível', stale: 'Dados antigos', not_configured: 'Coleta pendente', unavailable: 'Consulta indisponível' };
const descriptions: Record<string, string> = {
  barberias: 'Usuários de equipe e contas de assinatura. Ativação exige profissional ativo, serviço, horário e primeiro agendamento.',
  mecard: 'Usuários e contas seguem o relatório administrativo do MeCard, incluindo contas internas. Pro pode incluir teste e administração; não comprova pagamento.',
  members: 'Marketplace: a unidade é o produtor e a receita da plataforma vem das vendas (produtos próprios e comissões). Usuários incluem alunos, produtores e administração.',
  vibekit: 'Produto de compra única. Eventos anônimos e compras registradas têm unidades diferentes das contas de assinatura dos aplicativos.',
  'aglabs-app': 'Créditos: assinatura mensal com créditos ou pacote avulso. Usuários, compras, assinaturas e créditos dos últimos 30 dias, como no admin do app.',
};
export default function EcosystemPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('session');
      const response = await fetch('/api/ecosystem', { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('unavailable');
      const body = await response.json() as { products: Product[] };
      if (!controller.signal.aborted) setProducts(body.products);
    })().catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return <div className="mx-auto max-w-6xl space-y-5"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Ecossistema</h1><p className="mt-1 text-sm text-muted">Aplicativos → CRM → Órbita. Cada número mantém a definição e a fonte do produto.</p></div><Button size="sm" variant="secondary" disabled={loading} onClick={() => { setLoading(true); setError(false); setRevision(v => v + 1); }}><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button></header>
    {loading ? <PageLoader /> : error ? <p role="alert" className="rounded-xl border border-border p-4 text-sm">Consulta indisponível. Esta visão exige uma sessão administrativa válida. <Link className="text-brand underline" href="/login">Entrar no CRM</Link></p> : <div className="grid items-start gap-3 lg:grid-cols-3">{products.map(product => <section key={product.product} className="min-w-0 rounded-xl border border-border bg-surface p-4"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{productLabel(product.product)}</h2><span className={`text-xs ${product.status === 'ok' ? 'text-emerald-500' : 'text-muted'}`}>{statuses[product.status]}</span></div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{descriptions[product.product]}</p>{product.product === 'vibekit' ? product.data?.commerceFunnel && <CommerceFunnel funnel={product.data.commerceFunnel} window={product.data.window} /> : product.data?.marketplace ? <MarketplaceSummary data={product.data.marketplace} /> : product.data?.credits ? <CreditsSummary data={product.data.credits} /> : <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">{Object.entries(names).map(([key, name]) => { const value = product.data?.metrics[key as keyof typeof names]; return <div key={key}><dt className="text-xs text-muted">{name}</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{value == null ? '—' : value.toLocaleString('pt-BR')}</dd></div>; })}</dl>}
      {product.data && <ActivationFunnel snapshot={product.data} />}
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted">{product.message}</p><p className="mt-1 text-xs text-muted">{product.data ? `Origem: ${new Date(product.data.generatedAt).toLocaleString('pt-BR')}` : 'Sem snapshot confirmado na origem.'}</p>
    </section>)}</div>}
    <div className="flex flex-wrap gap-4 text-sm"><Link className="inline-flex items-center gap-1 text-brand" href="/actions">Revisar ações comerciais <ArrowUpRight className="h-3.5 w-3.5" /></Link><Link className="text-brand" href="/campaigns">E-mails e campanhas</Link><Link className="text-brand" href="/reports">Receita registrada</Link></div>
    <p className="text-xs leading-relaxed text-muted">Traço indica uma métrica não disponível, não zero. Contatos do CRM, usuários do aplicativo, acesso ativo e pagamento são medidas distintas. Não somar usuários entre aplicativos como pessoas únicas. Nenhuma ação administrativa é executada por esta tela.</p>
  </div>;
}
