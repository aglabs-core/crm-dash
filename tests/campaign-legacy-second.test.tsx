import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CampaignFollowupReview} from '@/components/CampaignFollowupReview';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
afterEach(()=>{cleanup();rpc.mockReset();});
const review={campaign_id:'campaign',fingerprint:'fingerprint',policy:{version:'barberias-prospect-second-v1',subject:'Conseguiu conhecer o Barberias?',text:'Approved text {{nome}}',waitSeconds:604800,format:'text_only'},recipients:[{recipient_id:'r',contact_id:'c',email:'synthetic@example.invalid',name:'Synthetic',parent:{id:'parent',subject:'Original subject',text:'Original offer',delivered_at:'2026-10-01T00:00:00Z'},reasons:[],message:{from:'original@example.invalid',to:'synthetic@example.invalid',subject:'Conseguiu conhecer o Barberias?',text:'Approved text Synthetic'}},{recipient_id:'blocked',contact_id:'cb',email:'blocked@example.invalid',name:'Blocked',parent:null,reasons:['missing_delivery'],message:{subject:'Subject',text:'Text'}}]};
it('prepares and explicitly approves reviewed recipients with exact readbacks, never dispatching',async()=>{
 let batch: null|{id:string;state:string;review:typeof review}=null;
 rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_campaign_legacy_second')return {data:batch,error:null};
  if(name==='review_campaign_legacy_second')return {data:review,error:null};
  if(name==='prepare_campaign_legacy_second'){batch={id:'batch',state:'draft',review};return {data:{batch_id:'batch',status:'draft'},error:null};}
  if(name==='approve_campaign_legacy_second'){expect(args.p_recipients).toEqual(['r']);batch={id:'batch',state:'approved',review};return {data:{batch_id:'batch',status:'approved'},error:null};}
  throw Error('Forbidden unexpected RPC '+name);
 });
 render(<CampaignFollowupReview campaignId="campaign" legacySecond />);
 fireEvent.click(screen.getByRole('button',{name:'Conferir impedimentos da segunda etapa'}));
 expect(await screen.findByText('Original offer')).toBeTruthy();
 expect(screen.getByText('Approved text Synthetic')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Preparar rascunho histórico'}));
 await screen.findByText('Rascunho histórico congelado; nenhuma mensagem enviada.');
 const approve=screen.getByRole('button',{name:'Aprovar segunda etapa sem envio'});
 expect(approve.hasAttribute('disabled')).toBe(true);
 expect(screen.getByRole('checkbox',{name:'Revisado blocked@example.invalid'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:'Revisado synthetic@example.invalid'}));
 fireEvent.change(screen.getByLabelText('Nota da revisão manual'),{target:{value:'Owner reviewed exact message and recipient'}});
 fireEvent.click(approve);fireEvent.click(approve);
 await screen.findByText('Segunda etapa aprovada; envio continua desativado.');
 expect(rpc.mock.calls.filter(([name])=>name==='approve_campaign_legacy_second')).toHaveLength(1);
 expect(rpc.mock.calls.filter(([name])=>name==='get_campaign_legacy_second')).toHaveLength(3);
 expect(screen.queryByRole('button',{name:/Enviar|Ativar/})).toBeNull();
});
it('stale approval remains unconfirmed and requires a fresh manual selection',async()=>{
 rpc.mockImplementation(async(name:string)=>name==='get_campaign_legacy_second'?{data:{id:'batch',state:'draft',review},error:null}:{data:null,error:{message:'stale'}});
 render(<CampaignFollowupReview campaignId="campaign" legacySecond />);
 fireEvent.click(screen.getByRole('button',{name:'Conferir impedimentos da segunda etapa'}));
 await screen.findByText('Original offer');
 fireEvent.click(screen.getByRole('checkbox',{name:'Revisado synthetic@example.invalid'}));
 fireEvent.change(screen.getByLabelText('Nota da revisão manual'),{target:{value:'Owner reviewed recipients'}});
 fireEvent.click(screen.getByRole('button',{name:'Aprovar segunda etapa sem envio'}));
 expect(await screen.findByRole('alert')).toBeTruthy();
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Revisado synthetic@example.invalid'}).getAttribute('aria-checked')).not.toBe('true'));
 expect(screen.queryByText('Segunda etapa aprovada; envio continua desativado.')).toBeNull();
});
