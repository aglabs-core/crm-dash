'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, TrendingUp, DollarSign, Timer, Download, CheckCircle2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import type { Deal } from '@/lib/types';
import { TONE_HEX } from '@/lib/constants';
import {
  avgDealSize,
  winRate,
  avgSalesCycleDays,
  winLossCounts,
  monthlySeries,
  pipelineByStage,
  revenueByProduct,
  uniqueProducts,
  filterDealsByPeriod,
} from '@/lib/analytics';
import { formatCurrency, formatCurrencyCompact, formatPercent, formatDate } from '@/lib/format';
import { CHART_AXIS_TICK, CHART_GRID, chartTooltipStyle, chartTooltipItemStyle, chartTooltipLabelStyle } from '@/lib/chart';
import { ChartCard, StatCard, Select, Button, PageLoader } from '@/components/ui';

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

export default function Reports() {
  const [allDeals, setAllDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [productFilter, setProductFilter] = useState('Todos');
  const [periodDays, setPeriodDays] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('deals').select('*').order('created_at', { ascending: true });
      if (error) console.error('Error fetching report data:', error);
      setAllDeals((data as Deal[]) || []);
      setIsLoading(false);
    })();
  }, []);

  const products = useMemo(() => uniqueProducts(allDeals), [allDeals]);

  const deals = useMemo(() => {
    const byPeriod = filterDealsByPeriod(allDeals, periodDays);
    return byPeriod.filter((d) => productFilter === 'Todos' || d.produto === productFilter);
  }, [allDeals, productFilter, periodDays]);

  const monthsWindow = periodDays ? Math.min(12, Math.max(2, Math.round(periodDays / 30))) : 12;

  const metrics = useMemo(() => {
    const { won, lost } = winLossCounts(deals);
    const cycle = avgSalesCycleDays(deals);
    return {
      avgDealSize: avgDealSize(deals),
      winRate: winRate(deals),
      salesCycle: cycle === null ? '—' : `${Math.round(cycle)} dias`,
      closed: won + lost,
      series: monthlySeries(deals, monthsWindow),
      funnel: pipelineByStage(deals),
      products: revenueByProduct(deals).slice(0, 8),
    };
  }, [deals, monthsWindow]);

  const exportCSV = () => {
    const headers = ['Título', 'Empresa', 'Produto', 'Estágio', 'Valor', 'Prioridade', 'Criado', 'Fechado'];
    const rows = deals.map((d) => [
      d.title,
      d.company || '',
      d.produto || '',
      d.stage,
      Number(d.amount) || 0,
      d.priority || '',
      d.created_at ? formatDate(d.created_at) : '',
      d.closed_at ? formatDate(d.closed_at) : '',
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
        <h1 className="text-2xl font-bold tracking-tight text-fg">Relatórios e Análises</h1>
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

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ticket Médio" value={formatCurrency(metrics.avgDealSize)} icon={DollarSign} hint="negócios ganhos" />
        <StatCard label="Taxa de Ganho" value={formatPercent(metrics.winRate)} icon={TrendingUp} hint="negócios fechados" />
        <StatCard label="Ciclo de Vendas" value={metrics.salesCycle} icon={Timer} hint="criação → fechamento" />
        <StatCard label="Negócios Fechados" value={metrics.closed} icon={CheckCircle2} hint="ganhos + perdidos" />
      </div>

      {/* Sales performance + conversion */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Desempenho de Vendas" subtitle="Ganhos vs perdidos por mês" icon={BarChart3}>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.series} margin={{ top: 16, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => formatCurrencyCompact(v)} width={68} />
                <Tooltip
                  cursor={{ fill: CHART_GRID }}
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any, name: any) => [formatCurrency(value), name === 'revenue' ? 'Ganhos' : 'Perdidos']}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 12 }} formatter={(v) => (v === 'revenue' ? 'Ganhos' : 'Perdidos')} />
                <Bar dataKey="revenue" name="revenue" fill={TONE_HEX.emerald} radius={[4, 4, 0, 0]} />
                <Bar dataKey="lost" name="lost" fill={TONE_HEX.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Taxa de Conversão" subtitle="% de negócios ganhos entre os fechados" icon={TrendingUp}>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.series} margin={{ top: 16, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => `${v}%`} domain={[0, 100]} width={44} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any) => [value === null || value === undefined ? '—' : `${value}%`, 'Conversão']}
                />
                <Line type="monotone" dataKey="rate" stroke={TONE_HEX.indigo} strokeWidth={3} connectNulls dot={{ r: 4, fill: TONE_HEX.indigo, strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      {/* Funnel + product */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Funil de Pipeline" subtitle="Valor em aberto por estágio">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.funnel} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => formatCurrencyCompact(v)} />
                <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} width={78} />
                <Tooltip
                  cursor={{ fill: CHART_GRID }}
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any, _n: any, item: any) => [`${formatCurrency(value)} · ${item?.payload?.count ?? 0} neg.`, 'Em aberto']}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {metrics.funnel.map((d) => (
                    <Cell key={d.stage} fill={TONE_HEX[d.tone as keyof typeof TONE_HEX]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Receita por Produto" subtitle="Negócios ganhos no período">
          <div className="h-80 w-full">
            {metrics.products.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">Sem receita no período.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.products} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                  <XAxis dataKey="produto" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} interval={0} height={40} />
                  <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => formatCurrencyCompact(v)} width={64} />
                  <Tooltip
                    cursor={{ fill: CHART_GRID }}
                    contentStyle={chartTooltipStyle}
                    itemStyle={chartTooltipItemStyle}
                    labelStyle={chartTooltipLabelStyle}
                    formatter={(value: any) => [formatCurrency(value), 'Receita']}
                  />
                  <Bar dataKey="revenue" fill={TONE_HEX.purple} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
