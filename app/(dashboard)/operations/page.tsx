'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { loadContactRollups, type ContactRollup } from '@/lib/contact-directory';
import { operationsSummary } from '@/lib/operations-workspace';
import { Button, PageLoader } from '@/components/ui';

const areas = [
  { title: 'Entradas do site', href: '/leads', detail: 'Pedidos recebidos pelo site. Triar e converter antes de conduzir a oportunidade.' },
  { title: 'Contatos e prospecção', href: '/contacts', detail: 'Base fria e cadastros a qualificar. Revisar elegibilidade antes de qualquer abordagem.' },
  { title: 'Funil comercial', href: '/deals', detail: 'Interesse comercial identificado, proposta e negociação. Cada oportunidade precisa de um próximo passo.' },
  { title: 'Clientes', href: '/clients', detail: 'Relacionamentos ganhos, ativos ou inativos. Conta gratuita de aplicativo não comprova compra.' },
  { title: 'Contas dos aplicativos', href: '/ecosystem', detail: 'Aquisição, ativação e uso por produto. O ciclo da conta é independente da etapa comercial.' },
  { title: 'E-mails e campanhas', href: '/campaigns', detail: 'Histórico de comunicação e aprovação de campanhas. Entrega automática não confirma conversa humana.' },
  { title: 'Central de ações', href: '/actions', detail: 'Tarefas vencidas, respostas recebidas e lacunas de próximo passo para revisão humana.' },
  { title: 'Financeiro', href: '/finance', detail: 'Recebimentos, devoluções e preparação fiscal. Valor no funil não equivale a dinheiro recebido.' },
];

export default function OperationsPage() {
  const [rows, setRows] = useState<ContactRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadContactRollups(controller.signal).then((data) => { if (!controller.signal.aborted) setRows(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);
  const totals = operationsSummary(rows);
  const buckets = [
    ['Base fria', totals.cold], ['A qualificar', totals.qualification], ['Funil ativo', totals.pipeline],
    ['Clientes ativos e inativos', totals.clients], ['Arquivados fora da base fria', totals.archived],
    ['Classificação a revisar', totals.unclassified],
  ] as const;
  return <div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Visão operacional</h1><p className="mt-1 text-sm text-muted">Organize a rotina comercial, os aplicativos e o fechamento da empresa.</p></div><Button size="sm" variant="secondary" disabled={loading} onClick={() => { setLoading(true); setFailed(false); setVersion((v) => v + 1); }}><RefreshCw className="h-4 w-4" />Atualizar</Button></header>
    {loading ? <PageLoader /> : failed ? <p role="alert" className="rounded-xl border border-border p-5">Não foi possível consultar a carteira. Atualize para tentar novamente.</p> : <>
      <section aria-label="Distribuição da carteira" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{buckets.map(([label, total]) => <div key={label} className="rounded-xl border border-border bg-surface p-4"><h2 className="text-xs text-muted">{label}</h2><p className="mt-2 text-2xl font-semibold tabular-nums">{total}</p></div>)}</section>
      <p className="text-xs text-muted">Cada contato entra em um único grupo acima. São contatos, não empresas únicas nem usuários únicos dos aplicativos. Entradas do site ainda não convertidas ficam na fila própria.</p>
      <section className="rounded-xl border border-border bg-surface p-4"><h2 className="text-sm font-semibold">Qualidade da base</h2><p className="mt-2 text-sm text-muted">{totals.missingProduct} contato(s) sem produto identificado · {totals.outreachReview} contato(s) da base fria aguardando revisão de abordagem. Estes indicadores podem se sobrepor.</p><Link href="/contacts" className="mt-3 inline-block text-sm text-brand underline">Revisar contatos e filtros</Link></section>
    </>}
    <section aria-label="Áreas de trabalho" className="grid gap-3 sm:grid-cols-2">{areas.map((area) => <Link key={area.href} href={area.href} className="rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"><h2 className="text-sm font-semibold text-brand">{area.title} →</h2><p className="mt-2 text-sm text-muted">{area.detail}</p></Link>)}</section>
    <section className="rounded-xl border border-border bg-surface p-5"><h2 className="font-semibold">Rotina recomendada</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted"><li>Diariamente: triar entradas, responder conversas e revisar tarefas vencidas.</li><li>Semanalmente: conferir propostas, pagamentos aguardados e oportunidades sem próximo passo.</li><li>Mensalmente: conciliar recebimentos, regularizar notas e reunir documentos para o contador.</li></ul></section>
  </div>;
}
