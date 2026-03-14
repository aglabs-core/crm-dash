'use client';

import { useState, useEffect } from 'react';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Users, 
  Briefcase, 
  CheckSquare, 
  DollarSign,
  Loader2
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function Dashboard() {
  const [stats, setStats] = useState([
    { name: 'Receita Total', value: 'R$ 0,00', icon: DollarSign, change: '0%', changeType: 'positive' },
    { name: 'Negócios Ativos', value: '0', icon: Briefcase, change: '0%', changeType: 'positive' },
    { name: 'Novos Contatos', value: '0', icon: Users, change: '0%', changeType: 'positive' },
    { name: 'Tarefas Concluídas', value: '0', icon: CheckSquare, change: '0%', changeType: 'positive' },
  ]);
  const [recentDeals, setRecentDeals] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch Deals
      const { data: dealsData, error: dealsError } = await supabase
        .from('deals')
        .select('*')
        .order('created_at', { ascending: false });

      if (dealsError) throw dealsError;

      // Fetch Contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('id, created_at');

      if (contactsError) throw contactsError;

      // Fetch Tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('id, status, created_at');

      if (tasksError) throw tasksError;

      // Calculate Stats
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const previousYear = currentMonth === 0 ? currentYear - 1 : currentYear;

      const isCurrentMonth = (dateString: string) => {
        if (!dateString) return false;
        const d = new Date(dateString);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      };

      const isPreviousMonth = (dateString: string) => {
        if (!dateString) return false;
        const d = new Date(dateString);
        return d.getMonth() === previousMonth && d.getFullYear() === previousYear;
      };

      const calculateChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? '+100%' : '0%';
        const change = ((current - previous) / previous) * 100;
        return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
      };

      const getChangeType = (current: number, previous: number) => {
        return current >= previous ? 'positive' : 'negative';
      };

      const activeDeals = dealsData?.filter(d => d.stage !== 'Ganho' && d.stage !== 'Perdido') || [];
      const wonDeals = dealsData?.filter(d => d.stage === 'Ganho') || [];
      
      const totalRevenue = wonDeals.reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0);
      const formattedRevenue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRevenue);

      const currentRevenue = wonDeals.filter(d => isCurrentMonth(d.created_at)).reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0);
      const previousRevenue = wonDeals.filter(d => isPreviousMonth(d.created_at)).reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0);
      const revenueChange = calculateChange(currentRevenue, previousRevenue);
      const revenueChangeType = getChangeType(currentRevenue, previousRevenue);

      const currentActiveDeals = activeDeals.filter(d => isCurrentMonth(d.created_at)).length;
      const previousActiveDeals = activeDeals.filter(d => isPreviousMonth(d.created_at)).length;
      const activeDealsChange = calculateChange(currentActiveDeals, previousActiveDeals);
      const activeDealsChangeType = getChangeType(currentActiveDeals, previousActiveDeals);

      const currentContacts = contactsData?.filter(c => isCurrentMonth(c.created_at)).length || 0;
      const previousContacts = contactsData?.filter(c => isPreviousMonth(c.created_at)).length || 0;
      const contactsChange = calculateChange(currentContacts, previousContacts);
      const contactsChangeType = getChangeType(currentContacts, previousContacts);

      const completedTasks = tasksData?.filter(t => t.status === 'completed') || [];
      const currentCompletedTasks = completedTasks.filter(t => isCurrentMonth(t.created_at)).length;
      const previousCompletedTasks = completedTasks.filter(t => isPreviousMonth(t.created_at)).length;
      const tasksChange = calculateChange(currentCompletedTasks, previousCompletedTasks);
      const tasksChangeType = getChangeType(currentCompletedTasks, previousCompletedTasks);

      setStats([
        { name: 'Receita Total', value: formattedRevenue, icon: DollarSign, change: revenueChange, changeType: revenueChangeType },
        { name: 'Negócios Ativos', value: activeDeals.length.toString(), icon: Briefcase, change: activeDealsChange, changeType: activeDealsChangeType },
        { name: 'Contatos', value: (contactsData?.length || 0).toString(), icon: Users, change: contactsChange, changeType: contactsChangeType },
        { name: 'Tarefas Concluídas', value: completedTasks.length.toString(), icon: CheckSquare, change: tasksChange, changeType: tasksChangeType },
      ]);

      setRecentDeals(dealsData?.slice(0, 4) || []);

      // Process Chart Data (Revenue by Month)
      const monthlyData: Record<string, number> = {};
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      
      wonDeals.forEach(deal => {
        const date = new Date(deal.created_at);
        const monthName = months[date.getMonth()];
        monthlyData[monthName] = (monthlyData[monthName] || 0) + (Number(deal.amount) || 0);
      });

      const formattedChartData = Object.keys(monthlyData).map(month => ({
        name: month,
        revenue: monthlyData[month]
      }));

      setChartData(formattedChartData.length > 0 ? formattedChartData : [{ name: 'Sem dados', revenue: 0 }]);

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Link href="/deals" className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">
            Novo Negócio
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-500">{stat.name}</span>
              <stat.icon className="h-5 w-5 text-gray-400" />
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-gray-900">{stat.value}</span>
            </div>
            <div className="mt-2 flex items-center text-sm">
              {stat.changeType === 'positive' ? (
                <ArrowUpRight className="h-4 w-4 text-emerald-500 mr-1" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={stat.changeType === 'positive' ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                {stat.change}
              </span>
              <span className="text-gray-500 ml-2">desde o mês passado</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Visão Geral da Receita</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ color: '#111827', fontWeight: 600 }}
                  formatter={(value: any) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), 'Receita']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Deals */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Negócios Recentes</h2>
            <Link href="/deals" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Ver todos</Link>
          </div>
          <div className="space-y-4">
            {recentDeals.length > 0 ? recentDeals.map((deal) => (
              <div key={deal.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">{deal.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{deal.company}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(deal.amount || 0)}
                  </p>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mt-1
                    ${deal.stage === 'Ganho' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20' : 
                      deal.stage === 'Perdido' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20' : 
                      'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/10'}`}>
                    {deal.stage}
                  </span>
                </div>
              </div>
            )) : (
              <p className="text-sm text-gray-500 text-center py-4">Nenhum negócio recente.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
