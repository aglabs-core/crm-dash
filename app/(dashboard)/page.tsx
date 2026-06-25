'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  DollarSign,
  TrendingUp,
  Sparkles,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  CalendarClock,
  PauseCircle,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import type { Deal, Task } from '@/lib/types';
import {
  totalRevenue,
  pipelineValue,
  openDealsCount,
  winRate,
  isWon,
  isOpen,
  monthlySeries,
  pipelineByStage,
  revenueByProduct,
  winLossCounts,
  isTaskOverdue,
  dealsClosingSoon,
} from '@/lib/analytics';
import { TONE_HEX } from '@/lib/constants';
import { formatCurrency, formatCurrencyCompact, formatPercent, formatChange, type Change } from '@/lib/format';
import { CHART_AXIS_TICK, CHART_GRID, chartTooltipStyle, chartTooltipItemStyle, chartTooltipLabelStyle } from '@/lib/chart';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, ChartCard, Button, Sparkline, PageLoader } from '@/components/ui';

const STALE_DAYS = 14;

function inMonth(dateStr: string | null | undefined, month: number, year: number) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

function Trend({ change, hint }: { change?: Change | null; hint?: string }) {
  if (change) {
    const Icon = change.type === 'positive' ? ArrowUpRight : change.type === 'negative' ? ArrowDownRight : Minus;
    const cls =
      change.type === 'positive'
        ? 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400'
        : change.type === 'negative'
          ? 'text-red-600 bg-red-500/10 dark:text-red-400'
          : 'text-muted bg-surface-2';
    return (
      <span className={cn('inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium', cls)}>
        <Icon className="h-3 w-3" />
        {change.text}
      </span>
    );
  }
  return <span className="text-xs text-muted">{hint ?? '—'}</span>;
}

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData(true);
    const channels = ['deals', 'tasks', 'activities'].map((table) =>
      supabase
        .channel(`dash-${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => fetchData())
        .subscribe(),
    );
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, []);

  const fetchData = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const [dealsRes, tasksRes] = await Promise.all([
        supabase.from('deals').select('*, contacts ( id, name )').order('created_at', { ascending: false }),
        supabase.from('tasks').select('*, contacts ( id, name )').order('due_date', { ascending: true }),
      ]);
      // Archived deals never feed the dashboard.
      setDeals(((dealsRes.data as Deal[]) || []).filter((d) => !d.archived));
      setTasks((tasksRes.data as Task[]) || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const m = useMemo(() => {
    const now = new Date();
    const curM = now.getMonth();
    const curY = now.getFullYear();
    const prev = new Date(curY, curM - 1, 1);

    const won = deals.filter(isWon);
    const revThis = won.filter((d) => inMonth(d.closed_at, curM, curY)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const revPrev = won
      .filter((d) => inMonth(d.closed_at, prev.getMonth(), prev.getFullYear()))
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);

    const series = monthlySeries(deals, 6);
    const last = series[series.length - 1];
    const prevPoint = series[series.length - 2];

    const stalled = deals
      .filter((d) => isOpen(d) && d.updated_at && Date.now() - new Date(d.updated_at).getTime() > STALE_DAYS * 86_400_000)
      .sort((a, b) => new Date(a.updated_at as string).getTime() - new Date(b.updated_at as string).getTime());

    return {
      revenue: totalRevenue(deals),
      revenueChange: formatChange(revThis, revPrev),
      pipeline: pipelineValue(deals),
      openCount: openDealsCount(deals),
      winRate: winRate(deals),
      newThis: last?.newCount ?? 0,
      newChange: formatChange(last?.newCount ?? 0, prevPoint?.newCount ?? 0),
      series,
      sparkRevenue: series.map((p) => p.revenue),
      sparkPipeline: series.map((p) => p.pipeline),
      sparkRate: series.map((p) => p.rate ?? 0),
      sparkNew: series.map((p) => p.newCount),
      funnel: pipelineByStage(deals),
      products: revenueByProduct(deals).slice(0, 6),
      winLoss: winLossCounts(deals),
      overdue: tasks.filter(isTaskOverdue),
      closing: dealsClosingSoon(deals, 30),
      stalled,
    };
  }, [deals, tasks]);

  if (isLoading) return <PageLoader />;

  const kpis: { id: string; label: string; value: React.ReactNode; icon: LucideIcon; color: string; spark: number[]; change?: Change | null; hint?: string }[] = [
    { id: 'sp-rev', label: 'Receita Ganha', value: formatCurrency(m.revenue), icon: DollarSign, color: TONE_HEX.indigo, spark: m.sparkRevenue, change: m.revenueChange },
    { id: 'sp-pipe', label: 'Em Pipeline', value: formatCurrency(m.pipeline), icon: Briefcase, color: TONE_HEX.emerald, spark: m.sparkPipeline, hint: `${m.openCount} abertos` },
    { id: 'sp-rate', label: 'Taxa de Ganho', value: formatPercent(m.winRate), icon: TrendingUp, color: TONE_HEX.amber, spark: m.sparkRate, hint: 'fechados' },
    { id: 'sp-new', label: 'Novos Negócios', value: m.newThis, icon: Sparkles, color: TONE_HEX.blue, spark: m.sparkNew, change: m.newChange },
  ];

  const attn = [
    { label: 'Tarefas vencidas', icon: AlertTriangle, color: TONE_HEX.red, count: m.overdue.length, sub: m.overdue[0]?.title ?? '', href: '/tasks' },
    { label: 'Fechando em 30 dias', icon: CalendarClock, color: TONE_HEX.amber, count: m.closing.length, sub: m.closing[0]?.title ?? '', href: '/deals' },
    { label: `Parados (+${STALE_DAYS} dias)`, icon: PauseCircle, color: TONE_HEX.gray, count: m.stalled.length, sub: m.stalled[0]?.title ?? '', href: '/deals' },
  ];

  const winLossData = [
    { name: 'Ganhos', value: m.winLoss.won, color: TONE_HEX.emerald },
    { name: 'Perdidos', value: m.winLoss.lost, color: TONE_HEX.red },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted">Resumo do seu funil de vendas</p>
        </div>
        <Link href="/deals">
          <Button>
            <Plus className="h-4 w-4" />
            Novo Negócio
          </Button>
        </Link>
      </div>

      {/* KPI strip */}
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.id} className="bg-surface p-5">
            <div className="flex items-center gap-2 text-muted">
              <k.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wide">{k.label}</span>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="text-2xl font-bold tracking-tight text-fg">{k.value}</span>
              <Trend change={k.change} hint={k.hint} />
            </div>
            <div className="mt-3 -mb-1">
              <Sparkline id={k.id} data={k.spark} color={k.color} />
            </div>
          </div>
        ))}
      </Card>

      {/* Revenue + Attention */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard
          title="Receita e Pipeline"
          subtitle="Últimos 6 meses · receita por data de fechamento"
          className="lg:col-span-2"
        >
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TONE_HEX.indigo} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={TONE_HEX.indigo} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPipe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TONE_HEX.emerald} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={TONE_HEX.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={CHART_AXIS_TICK} tickFormatter={(v) => formatCurrencyCompact(v)} width={70} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  itemStyle={chartTooltipItemStyle}
                  labelStyle={chartTooltipLabelStyle}
                  formatter={(value: any, name: any) => [formatCurrency(value), name === 'revenue' ? 'Receita' : 'Pipeline']}
                />
                <Area type="monotone" dataKey="revenue" name="revenue" stroke={TONE_HEX.indigo} strokeWidth={2} fill="url(#gRev)" />
                <Area type="monotone" dataKey="pipeline" name="pipeline" stroke={TONE_HEX.emerald} strokeWidth={2} fill="url(#gPipe)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <Card>
          <CardHeader>
            <CardTitle>Precisa de Atenção</CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {attn.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-surface-2/50"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${a.color}1f`, color: a.color }}
                >
                  <a.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{a.label}</p>
                  <p className="truncate text-xs text-muted">{a.count > 0 ? a.sub || `${a.count} item(ns)` : 'Tudo em dia'}</p>
                </div>
                <span className="text-lg font-bold text-fg">{a.count}</span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* Funnel + Win/Loss + Product */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard title="Funil de Pipeline" subtitle="Valor em aberto por estágio">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.funnel} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
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
                  {m.funnel.map((d) => (
                    <Cell key={d.stage} fill={TONE_HEX[d.tone as keyof typeof TONE_HEX]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Ganhos vs Perdidos" subtitle="Negócios fechados">
          <div className="flex h-64 w-full items-center justify-center">
            {m.winLoss.won + m.winLoss.lost === 0 ? (
              <p className="text-sm text-muted">Nenhum negócio fechado ainda.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={winLossData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2}>
                    {winLossData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} itemStyle={chartTooltipItemStyle} labelStyle={chartTooltipLabelStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Receita por Produto" subtitle="Negócios ganhos">
          <div className="h-64 w-full">
            {m.products.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">Sem receita registrada.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.products} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
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
