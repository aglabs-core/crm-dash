'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Banknote, RefreshCw, RotateCcw, Wallet } from 'lucide-react';
import { loadPaymentTransactions } from '@/lib/payment-data';
import { financeSummary, paymentIssues, PAYMENT_STATUS_LABELS, receiptMonth } from '@/lib/finance-workspace';
import type { PaymentTransaction } from '@/lib/types';
import { formatCurrency } from '@/lib/format';
import { productLabel } from '@/lib/product-label';
import { Button, MetricCard, PageLoader, Select } from '@/components/ui';

const PAGE_SIZE = 25;
export default function FinancePage() {
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [month, setMonth] = useState('all');
  const [product, setProduct] = useState('all');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadPaymentTransactions({ signal: controller.signal }).then((rows) => {
      if (!controller.signal.aborted) { setPayments(rows); setPage(0); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);
  const months = useMemo(() => [...new Set(payments.map((p) => receiptMonth(p.paid_at)).filter((m): m is string => !!m))].sort().reverse(), [payments]);
  const products = useMemo(() => [...new Set(payments.map((p) => p.product?.trim()).filter((p): p is string => !!p))].sort(), [payments]);
  const scoped = payments.filter((p) => (month === 'all' || (month === 'undated' ? !receiptMonth(p.paid_at) : receiptMonth(p.paid_at) === month))
    && (product === 'all' || (product === 'undefined' ? !p.product?.trim() : p.product?.trim() === product)));
  const summary = financeSummary(scoped);
  const visible = scoped.filter((p) => !reviewOnly || paymentIssues(p).length).sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || '') || a.id.localeCompare(b.id));
  const resetPage = () => setPage(0);
  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold">Financeiro</h1><p className="mt-1 text-sm text-muted">Recebimentos registrados e preparação do fechamento da empresa.</p></div><Button variant="secondary" size="sm" disabled={loading} onClick={() => { setLoading(true); setFailed(false); setVersion((v) => v + 1); }}><RefreshCw className="h-4 w-4" />Atualizar</Button></header>
    {loading ? <PageLoader /> : failed ? <p role="alert" className="rounded-xl border border-border p-5">Não foi possível consultar os pagamentos. Atualize para tentar novamente.</p> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Mês do recebimento<Select value={month} onChange={(e) => { setMonth(e.target.value); resetPage(); }}><option value="all">Todo o período</option>{months.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}<option value="undated">Sem data válida</option></Select></label>
        <label className="text-sm">Serviço ou produto<Select value={product} onChange={(e) => { setProduct(e.target.value); resetPage(); }}><option value="all">Todos</option>{products.map((p) => <option key={p} value={p}>{productLabel(p)}</option>)}<option value="undefined">Sem identificação</option></Select></label>
        <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={reviewOnly} onChange={(e) => { setReviewOnly(e.target.checked); resetPage(); }} />Somente pendências de revisão</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Valor original registrado" value={formatCurrency(summary.original)} icon={Banknote} hint="BRL, incluindo devolvidos e contestados; exclui cancelados" />
        <MetricCard label="Devoluções acumuladas" value={formatCurrency(summary.refunded)} icon={RotateCcw} tone="amber" hint="Associadas aos pagamentos selecionados" />
        <MetricCard label="Após devoluções e contestações" value={formatCurrency(summary.remaining)} icon={Wallet} tone="emerald" hint="Antes de taxas e tributos; não comprova saldo bancário" />
        <MetricCard label="Pagamentos para revisar" value={summary.reviewCount} icon={AlertCircle} tone="amber" hint="Vínculo, produto, data, moeda ou devolução" />
      </div>
      <p className="text-xs leading-relaxed text-muted">O mês considera a data de pagamento em São Paulo, não a competência fiscal. As devoluções são acumuladas no pagamento original; esta visão não é fluxo de caixa das devoluções nem lucro. {summary.foreignCount > 0 && `${summary.foreignCount} pagamento(s) em outra moeda fora dos totais em reais. `}{summary.undatedCount > 0 && `${summary.undatedCount} pagamento(s) sem data válida no recorte. `}As pendências abaixo são sinais para conferência manual.</p>
      <section className="overflow-hidden rounded-2xl border border-border bg-surface"><h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Pagamentos · {visible.length}</h2>
        {!visible.length ? <p className="p-5 text-sm text-muted">Nenhum pagamento encontrado neste recorte. Serviços ainda não registrados não aparecem aqui.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-surface-2 text-xs text-muted"><tr>{['Recebimento', 'Serviço / origem', 'Situação', 'Valor original', 'Conferência'].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p) => <tr key={p.id}>
          <td className="whitespace-nowrap px-4 py-3">{p.paid_at && receiptMonth(p.paid_at) ? new Date(p.paid_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Sem data'}</td>
          <td className="px-4 py-3"><p>{p.product?.trim() ? productLabel(p.product.trim()) : 'Sem serviço/produto'}</p><p className="text-xs text-muted">{p.gateway}</p></td>
          <td className="px-4 py-3">{PAYMENT_STATUS_LABELS[p.status]}</td>
          <td className="whitespace-nowrap px-4 py-3 tabular-nums">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: p.currency }).format(Number(p.amount))}</td>
          <td className="min-w-56 px-4 py-3"><p className="text-xs text-muted">{paymentIssues(p).join(' · ') || 'Sem pendências cadastrais detectadas'}</p>{p.contact_id && <Link className="mt-1 inline-block text-xs text-brand underline" href={`/contacts/${p.contact_id}`}>Abrir cliente e histórico</Link>}</td>
        </tr>)}</tbody></table></div>}
        {visible.length > PAGE_SIZE && <div className="flex items-center justify-between gap-2 border-t border-border p-3"><Button variant="ghost" size="sm" disabled={!page} onClick={() => setPage((v) => v - 1)}>Anterior</Button><span className="text-xs text-muted">Página {page + 1} de {Math.ceil(visible.length / PAGE_SIZE)}</span><Button variant="ghost" size="sm" disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage((v) => v + 1)}>Próxima</Button></div>}
      </section>
    </>}
    <section className="rounded-2xl border border-border bg-surface p-5"><h2 className="font-semibold">Fiscal e contabilidade</h2><p className="mt-2 text-sm text-muted">O CRM ainda não registra notas, despesas, aportes ou extratos. A situação fiscal dos pagamentos é desconhecida até a conferência dos documentos. Um pagamento registrado não comprova emissão de nota.</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm"><li>Conferir serviço prestado, tomador, valor e competência com os comprovantes.</li><li>Regularizar a NFS-e no emissor adequado e guardar XML, representação em PDF e eventuais cancelamentos.</li><li>Conciliar recebimentos com extrato, taxas e devoluções; separar valores da empresa e do sócio.</li><li>Entregar documentos e pendências ao contador para apuração e fechamento mensal.</li></ol><a className="mt-4 inline-block text-sm text-brand underline" href="https://www.nfse.gov.br/EmissorNacional/Login" target="_blank" rel="noopener noreferrer">Abrir Emissor Nacional da NFS-e</a></section>
  </div>;
}
