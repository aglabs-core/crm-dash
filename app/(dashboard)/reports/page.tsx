'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, DollarSign, Calendar, Loader2 } from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  LineChart,
  Line
} from 'recharts';
import { supabase } from '@/lib/supabase';

export default function Reports() {
  const [isLoading, setIsLoading] = useState(true);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [conversionData, setConversionData] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    avgDealSize: 'R$ 0,00',
    winRate: '0%',
    salesCycle: '0 Dias'
  });

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    try {
      setIsLoading(true);
      
      const { data: deals, error } = await supabase
        .from('deals')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (deals) {
        // Process Sales Data (Won vs Lost by Month)
        const monthlyData: Record<string, { won: number, lost: number }> = {};
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        deals.forEach(deal => {
          const date = new Date(deal.created_at);
          const monthName = months[date.getMonth()];
          
          if (!monthlyData[monthName]) {
            monthlyData[monthName] = { won: 0, lost: 0 };
          }
          
          if (deal.stage === 'Ganho') {
            monthlyData[monthName].won += Number(deal.amount) || 0;
          } else if (deal.stage === 'Perdido') {
            monthlyData[monthName].lost += Number(deal.amount) || 0;
          }
        });

        const formattedSalesData = Object.keys(monthlyData).map(month => ({
          name: month,
          won: monthlyData[month].won,
          lost: monthlyData[month].lost
        }));
        setSalesData(formattedSalesData.length > 0 ? formattedSalesData : [{ name: 'Sem dados', won: 0, lost: 0 }]);

        // Process Conversion Data (Real win rate by month)
        const conversionMonthlyData: Record<string, { won: number, totalClosed: number }> = {};
        
        deals.forEach(deal => {
          if (deal.stage === 'Ganho' || deal.stage === 'Perdido') {
            const date = new Date(deal.created_at);
            const monthName = months[date.getMonth()];
            
            if (!conversionMonthlyData[monthName]) {
              conversionMonthlyData[monthName] = { won: 0, totalClosed: 0 };
            }
            
            conversionMonthlyData[monthName].totalClosed += 1;
            if (deal.stage === 'Ganho') {
              conversionMonthlyData[monthName].won += 1;
            }
          }
        });

        const formattedConversionData = Object.keys(conversionMonthlyData).map(month => ({
          name: month,
          rate: conversionMonthlyData[month].totalClosed > 0 
            ? Math.round((conversionMonthlyData[month].won / conversionMonthlyData[month].totalClosed) * 100) 
            : 0
        }));

        setConversionData(formattedConversionData.length > 0 ? formattedConversionData : [{ name: 'Sem dados', rate: 0 }]);

        // Calculate Metrics
        const wonDeals = deals.filter(d => d.stage === 'Ganho');
        const closedDeals = deals.filter(d => d.stage === 'Ganho' || d.stage === 'Perdido');
        
        const totalWonValue = wonDeals.reduce((sum, deal) => sum + (Number(deal.amount) || 0), 0);
        const avgSize = wonDeals.length > 0 ? totalWonValue / wonDeals.length : 0;
        
        const winRate = closedDeals.length > 0 ? (wonDeals.length / closedDeals.length) * 100 : 0;

        setMetrics({
          avgDealSize: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(avgSize),
          winRate: `${winRate.toFixed(1)}%`,
          salesCycle: '14 Dias' // Mocked as we need closed_date vs created_date
        });
      }
    } catch (error) {
      console.error('Error fetching report data:', error);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Relatórios e Análises</h1>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center justify-center bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors">
            <Calendar className="h-4 w-4 mr-2" />
            Últimos 30 Dias
          </button>
          <button className="inline-flex items-center justify-center bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors">
            Exportar PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Sales Performance */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Desempenho de Vendas</h2>
              <p className="text-sm text-gray-500">Negócios Ganhos vs Perdidos ao longo do tempo</p>
            </div>
            <BarChart3 className="h-5 w-5 text-gray-400" />
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesData} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                <Tooltip 
                  cursor={{ fill: '#f3f4f6' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value), '']}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }} />
                <Bar dataKey="won" name="Negócios Ganhos" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="lost" name="Negócios Perdidos" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Taxa de Conversão</h2>
              <p className="text-sm text-gray-500">Tendência de conversão de lead para cliente</p>
            </div>
            <TrendingUp className="h-5 w-5 text-gray-400" />
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={conversionData} margin={{ top: 20, right: 30, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} tickFormatter={(value) => `${value}%`} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  formatter={(value: any) => [`${value}%`, 'Taxa de Conversão']}
                />
                <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Key Metrics Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Resumo das Principais Métricas</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
          <div className="p-6 flex flex-col items-center text-center">
            <div className="p-3 bg-indigo-50 rounded-full mb-4">
              <DollarSign className="h-6 w-6 text-indigo-600" />
            </div>
            <p className="text-sm font-medium text-gray-500">Tamanho Médio do Negócio</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{metrics.avgDealSize}</p>
          </div>
          <div className="p-6 flex flex-col items-center text-center">
            <div className="p-3 bg-emerald-50 rounded-full mb-4">
              <TrendingUp className="h-6 w-6 text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-gray-500">Taxa de Ganho</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{metrics.winRate}</p>
          </div>
          <div className="p-6 flex flex-col items-center text-center">
            <div className="p-3 bg-blue-50 rounded-full mb-4">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <p className="text-sm font-medium text-gray-500">Duração do Ciclo de Vendas</p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{metrics.salesCycle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
