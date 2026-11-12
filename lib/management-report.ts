import { supabase } from './supabase';
import type { Tone } from './constants';
import { loadContacts } from './contact-data';
import { loadPaymentTransactions } from './payment-data';
import { monthlySeries, salesContacts, filterByPeriod, pipelineValue, winRate, winLossCounts, productPerformance, leadsByProduct, isWon } from './analytics';
import { paymentProducts, paymentRevenue, paymentsByPeriod, netRevenue } from './payment-analytics';
import { KANBAN_STATUSES } from './constants';
export type ManagementReport = {
  version: 1; consultedAt: string; timeZone: 'America/Sao_Paulo'; product: string | null; days: number | null;
  products: string[]; contactsCount: number; aggregation?: 'database' | 'compatibility';
  journey?: { trackedSince: string; cohortSince: string; days: number; leads: number; converted: number; conversionRate: number | null; averageDaysToCustomer: number | null; completedStageTimes: {stage:string; completedintervals:number; averagedays:number}[] };
  quality: { totalContacts: number; missingProduct: number; missingChannel: number; sharedIdentityGroups: number; unassignedTasks: number; paymentsWithoutContact: number; paymentsWithoutDate: number } | null;
  metrics: {
    revenue: number; pipeline: number; avgDealSize: number; winRate: number | null; closed: number;
    funnel: { stage: string; label: string; tone: Tone; reached: number; value: number }[];
    series: { key: string; name: string; revenue: number; lost: number; rate: number | null }[];
    products: { produto: string; revenue: number; count: number }[];
    leadsProduct: { produto: string; count: number }[];
    perf: { produto: string; deals: number; openValue: number; wonValue: number; rate: number | null }[];
  };
};
export async function loadManagementReport(product: string | null, days: number | null, signal: AbortSignal, client = supabase): Promise<ManagementReport> {
  const { data, error } = await client.rpc('crm_management_report', { p_product: product, p_days: days,
    p_months: days ? Math.min(12, Math.max(2, Math.round(days / 30))) : 12 }).abortSignal(signal);
  // A rolling deployment may publish the UI before the additive database function.
  // Only a confirmed missing function enables compatibility; auth, network and SQL failures stay errors.
  if (error?.code === 'PGRST202' || error?.code === '42883') return compatibilityReport(product, days, signal, client);
  if (error) throw new Error('Relatório agregado indisponível. Confira a publicação da função de relatórios.');
  if (!data || data.version !== 1 || data.timeZone !== 'America/Sao_Paulo' || data.product !== product || data.days !== days || !data.metrics || !data.quality) throw new Error('Resposta de relatório incompatível');
  return { ...data, aggregation: 'database' } as ManagementReport;
}

async function compatibilityReport(product: string | null, days: number | null, signal: AbortSignal, client: typeof supabase): Promise<ManagementReport> {
  const [allContacts, allPayments] = await Promise.all([
    loadContacts('created_at', true, { signal, columns: 'id,produto,status,prospecting_pool,amount,created_at,closed_at' }, client),
    loadPaymentTransactions({ signal, columns: 'id,contact_id,product,currency,amount,refunded_amount,net_amount,status,paid_at' }, client),
  ]);
  const now=Date.now();
  const contacts=filterByPeriod(salesContacts(allContacts),days).filter(c=>(!product || c.produto?.trim()===product) && Date.parse(c.created_at || '')<=now);
  const payments=paymentsByPeriod(allPayments,days).filter(p=>(!product || p.product?.trim()===product) && (!p.paid_at || Date.parse(p.paid_at)<=now));
  const products=paymentProducts(payments); const perf=productPerformance(contacts);
  for(const row of perf) row.wonValue=0;
  for(const p of products) {
    const row=perf.find(r=>r.produto===p.produto);
    if(row) row.wonValue=p.revenue;
    else perf.push({produto:p.produto,deals:0,open:0,openValue:0,won:0,wonValue:p.revenue,lost:0,rate:null});
  }
  const positive=payments.filter(p=>netRevenue(p)>0).length;
  const {won,lost}=winLossCounts(contacts);
  const stages=[...KANBAN_STATUSES.map(s=>({stage:s.id,label:s.label,tone:s.tone})),{stage:'Cliente',label:'Cliente / Inativo',tone:'emerald' as const}];
  return {version:1,consultedAt:new Date().toISOString(),timeZone:'America/Sao_Paulo',product,days,aggregation:'compatibility',quality:null,
    products:[...new Set([...allContacts.map(c=>c.produto?.trim()),...allPayments.map(p=>p.product?.trim())].filter((p):p is string=>!!p))].sort(),contactsCount:contacts.length,
    metrics:{revenue:paymentRevenue(payments),pipeline:pipelineValue(contacts),avgDealSize:positive ? paymentRevenue(payments)/positive : 0,winRate:winRate(contacts),closed:won+lost,
      funnel:stages.map(s=>{const rows=contacts.filter(c=>s.stage==='Cliente' ? isWon(c) : c.status===s.stage);return {...s,reached:rows.length,value:rows.reduce((sum,c)=>sum+Number(c.amount || 0),0)};}),
      series:monthlySeries(contacts,days ? Math.min(12,Math.max(2,Math.round(days/30))) : 12,payments),products,perf,leadsProduct:leadsByProduct(contacts)}};
}
