'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Briefcase,
  DollarSign,
  TrendingUp,
  Plus,
  AlertTriangle,
  CalendarClock,
  PauseCircle,
  ArrowRight,
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
import type { Deal, Task, Contact } from '@/lib/types';
import {
  totalRevenue,
  pipelineValue,
  openDealsCount,
  winRate,
  isWon,
  monthlySeries,
  pipelineByStage,
  revenueByProduct,
  winLossCounts,
  isTaskOverdue,
  dealsClosingSoon,
  isOpen,
} from '@/lib/analytics';
import { TONE_HEX, stageTone } from '@/lib/constants';
import { formatCurrency, formatCurrencyCompact, formatPercent, formatChange, formatDate } from '@/lib/format';
import { CHART_AXIS_TICK, CHART_GRID, chartTooltipStyle, chartTooltipItemStyle, chartTooltipLabelStyle } from '@/lib/chart';
import { Card, CardHeader, CardTitle, CardBody, ChartCard, StatCard, Button, Badge, PageLoader, EmptyState } from '@/components/ui';

const STALE_DAYS = 14;

function inMonth(dateStr: string | null | undefined, month: number, year: number) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getMonth() === month && d.getFullYear() === year;
}

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData(true);
    const channels = ['deals', 'contacts', 'tasks', 'activities'].map((table) =>
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
      const [dealsRes, tasksRes, contactsRes] = await Promise.all([
        supabase.from('deals').select('*, contacts ( id, name )').order('created_at', { ascending: false }),
        supabase.from('tasks').select('*, contacts ( id, name )').order('due_date', { ascending: true }),
        supabase.from('contacts').select('id, created_at'),
      ]);
      setDeals((dealsRes.data as Deal[]) || []);
      setTasks((tasksRes.data as Task[]) || []);
      setContacts((contactsRes.data as Contact[]) || []);
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
    const prevM = prev.getMonth();
    const prevY = prev.getFullYear();

    const won = deals.filter(isWon);
    const revThis = won.filter((d) => inMonth(d.closed_at, curM, curY)).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const revPrev = won.filter((d) => inMonth(d.closed_at, prevM, prevY)).reduce((s, d) => s + (Number(d.amount) || 0), 0);

    const contactsThis = contacts.filter((c) => inMonth(c.created_at, curM, curY)).length;
    const contactsPrev = contacts.filter((c) => inMonth(c.created_at, prevM, prevY)).length;

    const overdue = tasks.filter(isTaskOverdue);
    const closing = dealsClosingSoon(deals, 30);
    const stalled = deals
      .filter((d) => isOpen(d) && d.updated_at && Date.now() - new Date(d.updated_at).getTime() > STALE_DAYS * 86_400_000)
      .sort((a, b) => new Date(a.updated_at as string).getTime() - new Date(b.updated_at as string).getTime());

    return {
      revenue: totalRevenue(deals),
      revenueChange: formatChange(revThis, revPrev),
      pipeline: pipelineValue(deals),
      openCount: openDealsCount(deals),
      winRate: winRate(deals),
      contactsTotal: contacts.length,
      contactsChange: formatChange(contactsThis, contactsPrev),
      series: monthlySeries(deals, 6),
      funnel: pipelineByStage(deals),
      products: revenueByProduct(deals).slice(0, 6),
      winLoss: winLossCounts(deals),
      overdue,
      closing,
      stalled,
      recent: deals.slice(0, 5),
    };
  }, [deals, tasks, contacts]);

  if (isLoading) return <PageLoader />;

  const winLossData = [
    { name: 'Ganhos', value: m.winLoss.won, color: TONE_HEX.emerald },
    { name: 'Perdidos', value: m.winLoss.lost, color: TONE_HEX.red },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Dashboard</h1>
        <Link href="/deals">
          <Button>
            <Plus className="h-4 w-4" />
            Novo Negócio
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Receita Ganha" value={formatCurrency(m.revenue)} icon={DollarSign} change={m.revenueChange} hint="vs. mês passado" />
        <StatCard label="Em Pipeline" value={formatCurrency(m.pipeline)} icon={Briefcase} hint={`${m.openCount} negócios abertos`} />
        <StatCard label="Taxa de Ganho" value={formatPercent(m.winRate)} icon={TrendingUp} hint="negócios fechados" />
        <StatCard label="Contatos" value={m.contactsTotal} icon={Users} change={m.contactsChange} hint="vs. mês passado" />
      </div>

      {/* Attention */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <AttentionCard
          icon={AlertTriangle}
          tone="red"
          title="Tarefas Vencidas"
          count={m.overdue.length}
          href="/tasks"
          items={m.overdue.slice(0, 3).map((t) => ({ id: t.id, label: t.title, meta: formatDate(t.due_date) }))}
          empty="Nenhuma tarefa vencida."
        />
        <AttentionCard
          icon={CalendarClock}
          tone="amber"
          title="Fechando em 30 dias"
          count={m.closing.length}
          href="/deals"
          items={m.closing.slice(0, 3).map((d) => ({ id: d.id, label: d.title, meta: formatCurrency(d.amount) }))}
          empty="Nada previsto para fechar."
        />
        <AttentionCard
          icon={PauseCircle}
          tone="gray"
          title={`Parados (+${STALE_DAYS}d)`}
          count={m.stalled.length}
          href="/deals"
          items={m.stalled.slice(0, 3).map((d) => ({ id: d.id, label: d.title, meta: `sem movimentação` }))}
          empty="Nenhum negócio parado."
        />
      </div>

      {/* Revenue + Funnel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard title="Receita e Pipeline" subtitle="Últimos 6 meses (receita por data de fechamento)" className="lg:col-span-2">
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

        <ChartCard title="Funil de Pipeline" subtitle="Valor em aberto por estágio">
          <div className="h-72 w-full">
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
      </div>

      {/* Win/Loss + Products + Recent */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ChartCard title="Ganhos vs Perdidos" subtitle="Negócios fechados">
          <div className="flex h-64 w-full items-center justify-center">
            {m.winLoss.won + m.winLoss.lost === 0 ? (
              <p className="text-sm text-muted">Nenhum negócio fechado ainda.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={winLossData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={2}>
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
                  <Bar dataKey="revenue" fill={TONE_HEX.indigo} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <Card>
          <CardHeader>
            <CardTitle>Negócios Recentes</CardTitle>
            <Link href="/deals" className="text-sm font-medium text-brand hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardBody className="space-y-1">
            {m.recent.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">Nenhum negócio recente.</p>
            ) : (
              m.recent.map((deal) => (
                <Link
                  key={deal.id}
                  href={deal.contacts ? `/contacts/${deal.contacts.id}` : '/deals'}
                  className="flex items-center justify-between gap-2 rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{deal.title}</p>
                    <p className="truncate text-xs text-muted">{deal.company || deal.contacts?.name || '—'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-fg">{formatCurrency(deal.amount)}</span>
                    <Badge tone={stageTone(deal.stage)}>{deal.stage}</Badge>
                  </div>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function AttentionCard({
  icon: Icon,
  tone,
  title,
  count,
  href,
  items,
  empty,
}: {
  icon: typeof AlertTriangle;
  tone: keyof typeof TONE_HEX;
  title: string;
  count: number;
  href: string;
  items: { id: string; label: string; meta: string }[];
  empty: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${TONE_HEX[tone]}1f`, color: TONE_HEX[tone] }}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-fg">{title}</span>
        </div>
        <span className="text-2xl font-bold text-fg">{count}</span>
      </div>
      <div className="mt-3 space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-muted">{empty}</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-fg">{it.label}</span>
              <span className="shrink-0 text-muted">{it.meta}</span>
            </div>
          ))
        )}
      </div>
      {count > 0 && (
        <Link href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          Ver todos <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </Card>
  );
}
