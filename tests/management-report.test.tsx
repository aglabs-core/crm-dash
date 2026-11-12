import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Reports from '@/app/(dashboard)/reports/page';
import type { ManagementReport } from '@/lib/management-report';

const source=vi.hoisted(()=>({ fail:false, calls:[] as Array<{product:string|null;days:number|null}> }));
vi.mock('@/lib/management-report',()=>({ loadManagementReport: async (product:string|null,days:number|null):Promise<ManagementReport>=>{
  source.calls.push({product,days}); if(source.fail) throw new Error('synthetic');
  return {version:1,consultedAt:'2026-11-12T12:00:00Z',timeZone:'America/Sao_Paulo',product,days,aggregation:'database',products:['barberias'],contactsCount:10,
    quality:{totalContacts:12,missingProduct:1,missingChannel:2,sharedIdentityGroups:1,unassignedTasks:3,paymentsWithoutContact:1,paymentsWithoutDate:0},
    metrics:{revenue:100,pipeline:500,avgDealSize:100,winRate:null,closed:0,series:[],funnel:[{stage:'Lead',label:'Lead',tone:'blue',reached:2,value:100},{stage:'Contatado',label:'Contatado',tone:'indigo',reached:8,value:400}],products:[],leadsProduct:[],perf:[]}};
} }));
vi.mock('recharts',()=>{
  const Div=({children}:{children?:React.ReactNode})=><div>{children}</div>;
  return {ResponsiveContainer:Div,BarChart:Div,AreaChart:Div,Bar:()=>null,Area:()=>null,XAxis:()=>null,YAxis:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,Legend:()=>null};
});
afterEach(()=>{cleanup();source.fail=false;source.calls=[];});
it('shows aggregates and quality, with current-stage shares and server-side filters',async()=>{
  render(<Reports/>);
  expect(await screen.findByText('Distribuição comercial')).toBeTruthy();
  expect(screen.getByText('20% do total')).toBeTruthy(); expect(screen.getByText('80% do total')).toBeTruthy();
  expect(screen.queryByText('400%')).toBeNull();
  expect(screen.getByRole('region',{name:'Qualidade dos dados'})).toBeTruthy();
  expect(screen.getByRole('button',{name:'Exportar resumo agregado'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Exportar negócios'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Produto do relatório'),{target:{value:'barberias'}});
  await screen.findByText('Distribuição comercial');
  expect(source.calls.at(-1)).toEqual({product:'barberias',days:null});
  fireEvent.change(screen.getByLabelText('Período do relatório'),{target:{value:'30'}});
  await screen.findByText('Distribuição comercial');
  expect(source.calls.at(-1)).toEqual({product:'barberias',days:30});
});
it('query failure hides totals and allows retry without declaring zero',async()=>{
  source.fail=true;render(<Reports/>);await screen.findByRole('alert');
  expect(screen.queryByText('Receita após estornos')).toBeNull();
  source.fail=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  expect(await screen.findByText('Distribuição comercial')).toBeTruthy();
});
