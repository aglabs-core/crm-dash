import type { ProductSnapshot } from '@/lib/product-metrics';

const stages = { professional: 'Profissional ativo', catalog: 'Serviços cadastrados', readyForBooking: 'Prontas para agendar', firstAppointment: 'Agenda iniciada' } as const;

export function ActivationFunnel({ snapshot }: { snapshot: ProductSnapshot }) {
  const funnel = snapshot.activationFunnel;
  const total = snapshot.metrics.accounts;
  if (!funnel || total == null) return null;
  const waiting = funnel.readyForBooking - funnel.firstAppointment;
  return <details className="mt-4 border-t border-border pt-3">
    <summary className="cursor-pointer text-xs font-medium">Ativação · {waiting.toLocaleString('pt-BR')} prontas sem reserva</summary>
    <ol className="mt-3 space-y-2.5" aria-label="Etapas de ativação das contas">
      {Object.entries(stages).map(([key, label]) => {
        const value = funnel[key as keyof typeof stages];
        return <li key={key} className="text-xs"><div className="flex justify-between gap-2"><span className="text-muted">{label}</span><span className="tabular-nums">{value.toLocaleString('pt-BR')} / {total.toLocaleString('pt-BR')}</span></div><progress aria-label={label} value={value} max={total || 1} className="mt-1 block h-1 w-full accent-brand" /></li>;
      })}
    </ol>
    <p className="mt-3 text-xs leading-relaxed text-muted">Estoque atual de {total.toLocaleString('pt-BR')} contas, com filiais consolidadas. Etapas cumulativas na mesma unidade. Não representa conversão de uma campanha ou coorte.</p>
  </details>;
}
