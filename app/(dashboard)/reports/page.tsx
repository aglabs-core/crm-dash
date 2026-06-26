'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Download,
  CheckCircle2,
  Briefcase,
  Package,
  Users,
  Filter,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import type { Contact } from '@/lib/types';
import { TONE_HEX, type Tone } from '@/lib/constants';
import {
  avgDealSize,
  winRate,
  winLossCounts,
  monthlySeries,
  conversionFunnel,
  pipelineValue,
  totalRevenue,
  revenueByProduct,
  productPerformance,
  leadsByProduct,
  uniqueProducts,
  filterByPeriod,
} from '@/lib/analytics';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, formatDate } from '@/lib/format';
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  chartTooltipStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
} from '@/lib/chart';
import { cn } from '@/lib/utils';
import { Select, Button, PageLoader, BarList, MetricCard } from '@/components/ui';
import { FunnelChart } from '@/components/ui/funnel-chart';

const PERIODS: { label: string; value: number | null }[] = [
  { label: 'Últimos 30 dias', value: 30 },
  { label: 'Últimos 90 dias', value: 90 },
  { label: 'Último ano', value: 365 },
  { label: 'Todo o período', value: null },
];

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Refined section card with a tone-colored icon chip in the header. */
function Panel({
  title,
  subtitle,
  icon: Icon,
  tone = 'indigo',
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: Tone;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const color = TONE_HEX[tone];
  return (
    <div className={cn('rounded-2xl border border-border bg-surface shadow-sm', className)}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          {Icon && (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset"
              style={{ background: `${color}1f`, color, borderColor: `${color}33` }}
            >
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </div>
  );
}

export default function Reports() {
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [productFilter, setProductFilter] = useState('Todos');
  const [periodDays, setPeriodDays] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: true });
      if (error) console.error('Error fetching report data:', error);
      setAllContacts((data as Contact[]) || []);
      setIsLoading(false);
    })();
  }, []);

  const products = useMemo(() => uniqueProducts(allContacts), [allContacts]);

  const contacts = useMemo(() => {
    const byPeriod = filterByPeriod(allContacts, periodDays);
    return byPeriod.filter((c) => productFilter === 'Todos' || c.produto === productFilter);
  }, [allContacts, productFilter, periodDays]);

  const monthsWindow = periodDays ? Math.min(12, Math.max(2, Math.round(periodDays / 30))) : 12;

  const metrics = useMemo(() => {
    const { won, lost } = winLossCounts(contacts);
    return {
      revenue: totalRevenue(contacts),
      pipeline: pipelineValue(contacts),
      avgDealSize: avgDealSize(contacts),
      winRate: winRate(contacts),
      closed: won + lost,
      series: monthlySeries(contacts, monthsWindow),
      funnel: conversionFunnel(contacts),
      products: revenueByProduct(contacts).slice(0, 8),
      perf: productPerformance(contacts),
      leadsProduct: leadsByProduct(contacts).slice(0, 8),
    };
  }, [contacts, monthsWindow]);

  const funnelTop = metrics.funnel[0]?.reached ?? 0;
  const hasFunnel = funnelTop > 0;
  const funnelData = useMemo(
    () =>
      metrics.funnel.map((s) => ({
        label: s.label,
        value: s.reached,
        displayValue: formatNumber(s.reached),
        color: TONE_HEX[s.tone],
      })),
    [metrics.funnel],
  );

  const periodLabel = PERIODS.find((p) => p.value === periodDays)?.label ?? 'Todo o período';

  const exportCSV = () => {
    const headers = ['Nome', 'Empresa', 'Produto', 'Status', 'Origem', 'Valor', 'Prioridade', 'Criado', 'Fechado'];
    const rows = contacts.map((c) => [
      c.name,
      c.company || '',
      c.produto || '',
      c.status,
      c.origin || '',
      Number(c.amount) || 0,
      c.priority || '',
      c.created_at ? formatDate(c.created_at) : '',
      c.closed_at ? formatDate(c.closed_at) : '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Relatórios e Análises</h1>
          <p className="mt-0.5 text-sm text-muted">
            {formatNumber(contacts.length)} no funil · <span className="text-fg/80">{periodLabel}</span>
            {productFilter !== 'Todos' && (
              <>
                {' '}
                · <span className="text-fg/80">{productFilter}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="sm:w-44">
            <option value="Todos">Todos os Produtos</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select
            value={periodDays === null ? '' : String(periodDays)}
            onChange={(e) => setPeriodDays(e.target.value === '' ? null : Number(e.target.value))}
            className="sm:w-44"
          >
            {PERIODS.map((p) => (
              <option key={p.label} value={p.value === null ? '' : p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={exportCSV}>
            <Download className="h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Receita Ganha" value={formatCurrency(metrics.revenue)} icon={DollarSign} tone="emerald" hint="clientes" />
        <MetricCard label="Em Pipeline" value={formatCurrency(metrics.pipeline)} icon={Briefcase} tone="indigo" hint="em atendimento" />
        <MetricCard label="Ticket Médio" value={formatCurrency(metrics.avgDealSize)} icon={TrendingUp} tone="blue" hint="por cliente" />
        <MetricCard label="Taxa de Ganho" value={formatPercent(metrics.winRate)} icon={CheckCircle2} tone="amber" hint="fechados" />
      </div>

      {/* Conversion funnel — hero */}
      <Panel
        title="Funil de Conversão"
        subtitle="Quantos contatos alcançam cada etapa, do Lead ao Cliente"
        icon={Filter}
        tone="indigo"
        action={
          <span className="hidden rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted sm:inline-block">
            {formatNumber(funnelTop)} em jogo
          </span>
        }
      >
        {hasFunnel ? (
          <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <FunnelChart
                data={funnelData}
                orientation="horizontal"
                layers={3}
                edges="curved"
                gap={6}
                labelLayout="grouped"
                labelOrientation="vertical"
                labelAlign="center"
                formatValue={(v) => formatNumber(v)}
                formatPercentage={(p) => `${Math.round(p)}%`}
              />
            </div>
            <div className="flex flex-col gap-2 lg:col-span-2">
              {metrics.funnel.map((s, i) => {
                const fromTop = funnelTop ? (s.reached / funnelTop) * 100 : 0;
                return (
                  <div
                    key={s.stage}
                    className="flex items-center gap-3 rounded-xl border border-border/70 bg-surface-2/40 px-3 py-2.5 transition-colors hover:bg-surface-2/70"
                  >
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: TONE_HEX[s.tone] }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-fg">{s.label}</span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-fg">{formatNumber(s.reached)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="tabular-nums">{formatCurrencyCompact(s.value)}</span>
                        <span className="tabular-nums">{i === 0 ? '100% · topo' : `${fromTop.toFixed(0)}% do topo`}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center text-sm text-muted">
            Sem contatos ativos no funil para o período.
          </div>
        )}
      </Panel>

      {/* Sales performance + conversion */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Desempenho de Vendas" subtitle="Ganhos vs perdidos por mês" icon={BarChart3} tone="emerald">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.series} margin={{ top: 16, right: 12, left: -8, bottom: 0 }} barGap={4}>
                <defs>
                  <linearGradient id="gWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TONE_HEX.emerald} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={TONE_HEX.emerald} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gLost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TONE_HEX.red} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={TONE_HEX.red} stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => formatCurrencyCompact(v)} width={64} />
                <Tooltip
                  cursor={{ fill: 'rgba(161,161,170,0.08)' }}
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any, name: any) => [formatCurrency(value), name === 'revenue' ? 'Ganhos' : 'Perdidos']}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => (v === 'revenue' ? 'Ganhos' : 'Perdidos')} />
                <Bar dataKey="revenue" name="revenue" fill="url(#gWon)" radius={[5, 5, 0, 0]} maxBarSize={36} />
                <Bar dataKey="lost" name="lost" fill="url(#gLost)" radius={[5, 5, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Taxa de Conversão" subtitle="% de ganhos entre os fechados" icon={TrendingUp} tone="indigo">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.series} margin={{ top: 16, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TONE_HEX.indigo} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={TONE_HEX.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} dy={8} padding={{ left: 8, right: 8 }} />
                <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => `${v}%`} domain={[0, 100]} width={40} />
                <Tooltip
                  cursor={{ stroke: CHART_GRID, strokeWidth: 1 }}
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any) => [value === null || value === undefined ? '—' : `${value}%`, 'Conversão']}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke={TONE_HEX.indigo}
                  strokeWidth={2.5}
                  fill="url(#gRate)"
                  connectNulls
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)', fill: TONE_HEX.indigo }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Revenue by product + leads by product */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Receita por Produto" subtitle="Clientes fechados no período" icon={Package} tone="purple">
          <div className="h-80 w-full">
            <BarList
              emptyMessage="Sem receita no período."
              items={metrics.products.map((p) => ({
                label: p.produto,
                value: p.revenue,
                display: formatCurrencyCompact(p.revenue),
                sub: `${p.count} cliente${p.count === 1 ? '' : 's'}`,
                color: TONE_HEX.purple,
              }))}
            />
          </div>
        </Panel>

        <Panel title="Leads por Produto" subtitle="Volume de contatos por produto" icon={Users} tone="blue">
          <div className="h-80 w-full">
            <BarList
              emptyMessage="Sem leads no período."
              items={metrics.leadsProduct.map((p) => ({
                label: p.produto,
                value: p.count,
                display: formatNumber(p.count),
                color: TONE_HEX.blue,
              }))}
            />
          </div>
        </Panel>
      </div>

      {/* Product performance table */}
      <Panel
        title="Desempenho por Produto"
        subtitle="Funil completo, do lead à receita"
        icon={Layers}
        tone="amber"
        bodyClassName="p-0"
      >
        {metrics.perf.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted">Sem dados no período.</div>
        ) : (
          <div className="max-h-[26rem] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="py-3 pl-5 pr-3">Produto</th>
                  <th className="px-3 py-3 text-right">Leads</th>
                  <th className="px-3 py-3 text-right">Aberto</th>
                  <th className="px-3 py-3 text-right">Receita</th>
                  <th className="py-3 pl-3 pr-5 text-right">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {metrics.perf.map((p) => {
                  const rate = p.rate;
                  const rateTone =
                    rate === null
                      ? 'text-muted'
                      : rate >= 50
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : rate >= 25
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400';
                  return (
                    <tr key={p.produto} className="transition-colors hover:bg-surface-2/40">
                      <td className="py-3 pl-5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_HEX.purple }} />
                          <span className="font-medium text-fg">{p.produto}</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">{formatNumber(p.deals)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted">{formatCurrencyCompact(p.openValue)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatCurrencyCompact(p.wonValue)}
                      </td>
                      <td className={cn('py-3 pl-3 pr-5 text-right font-semibold tabular-nums', rateTone)}>
                        {rate === null ? '—' : `${rate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
