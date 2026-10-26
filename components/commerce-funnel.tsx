import type { CommerceFunnel as Funnel } from '@/lib/commerce-funnel';

const events = { pageViews: 'Visualizações de página', pricingViews: 'Visualizações do preço', ctaClicks: 'Cliques em chamadas', checkoutClicks: 'Cliques em comprar', checkoutCreated: 'Checkouts criados', checkoutFailures: 'Falhas de checkout', successViews: 'Visitas à página de sucesso' } as const;
const number = (n: number | null) => n === null ? '—' : n.toLocaleString('pt-BR');

export function CommerceFunnel({ funnel, window }: { funnel: Funnel; window: { from: string; to: string } }) {
  return <div className="mt-4 space-y-3">
    <dl className="grid grid-cols-2 gap-3">
      <div><dt className="text-xs text-muted">Compras registradas</dt><dd className="text-xl font-semibold tabular-nums">{number(funnel.registeredPurchases)}</dd></div>
      <div><dt className="text-xs text-muted">Acessos provisionados</dt><dd className="text-xl font-semibold tabular-nums">{number(funnel.provisionedPurchases)}</dd></div>
    </dl>
    <p className="text-xs text-muted">Valor dos checkouts registrados: {funnel.registeredCheckoutAmountCents === null ? '—' : (funnel.registeredCheckoutAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Sem descontar estornos ou taxas; não representa receita líquida ou liquidada.</p>
    <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-medium">Eventos do funil</summary>
      <dl className="mt-3 space-y-2">{Object.entries(events).map(([key, label]) => <div key={key} className="flex justify-between gap-3 text-xs"><dt className="text-muted">{label}</dt><dd className="tabular-nums">{number(funnel.events[key as keyof typeof events])}</dd></div>)}</dl>
      <p className="mt-3 text-xs leading-relaxed text-muted">Contagens anônimas, sem visitantes únicos ou taxa de conversão entre etapas. Uma visita à página de sucesso não comprova compra. Opt-out, bloqueios e falhas de coleta reduzem a cobertura.</p>
    </details>
    <p className="text-xs text-muted">Janela: {new Date(window.from).toLocaleString('pt-BR')} a {new Date(window.to).toLocaleString('pt-BR')}. {funnel.observedFrom ? `Coleta de eventos iniciada em ${new Date(funnel.observedFrom).toLocaleString('pt-BR')}.` : 'Sem cobertura de eventos confirmada.'}</p>
  </div>;
}
