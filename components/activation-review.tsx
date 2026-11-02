import { activationGaps } from '@/lib/activation-review';
import type { ProductMetricsResult } from '@/lib/product-metrics';

export function ActivationReview({ result }: { result: ProductMetricsResult }) {
  if (result.status !== 'ok' || !result.data) return null;
  const gaps = activationGaps(result.data);
  if (!gaps.length) return null;
  const largest = gaps.reduce((best, gap) => gap.count > best.count ? gap : best);
  return <div className="mt-4 rounded-lg border border-border bg-background p-3">
    <h3 className="text-sm font-medium">Onde revisar a ativação</h3>
    <ul className="mt-2 space-y-1.5 text-xs">{gaps.map(gap => <li key={gap.label} className="flex justify-between gap-3"><span className="text-muted">{gap.label}</span><strong className="tabular-nums">{gap.count.toLocaleString('pt-BR')}</strong></li>)}</ul>
    <p className="mt-3 text-xs leading-relaxed"><strong>Maior grupo a investigar:</strong> {largest.action}</p>
    <p className="mt-2 text-xs leading-relaxed text-muted">Retrato atual, incluindo contas internas quando presentes na origem. Não indica abandono, intenção de compra ou conversão de campanha.</p>
  </div>;
}
