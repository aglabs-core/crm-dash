import {Suspense} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import CampaignDetail from '@/app/(dashboard)/campaigns/[id]/page';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/contact-data',()=>({loadContacts:async()=>[]}));
vi.mock('@/components/ConfirmDialog',()=>({useConfirm:()=>vi.fn()}));
vi.mock('@/components/CampaignApproval',()=>({CampaignApproval:()=> <p>Initial approval pane</p>}));
vi.mock('@/lib/supabase',()=>({supabase:{
 auth:{getUser:async()=>({data:{user:{id:'owner'}}})},rpc,
 from:(table:string)=>{
  const q={select:()=>q,eq:()=>q,order:()=>q,
   single:async()=>({data:{id:'historical',name:'Historical campaign',user_id:'owner',provider:'brevo',product:'barberias',status:'completed',sender_email:'mutable@example.invalid',subject:'Mutable subject'},error:null}),
   range:async()=>({data:table==='email_campaign_recipients'?[{id:'r',campaign_id:'historical',contact_id:'c',email_snapshot:'synthetic@example.invalid',review_note:'Original review',provider_message_id:'original-provider-id'}]:[],error:null}),in:()=>q};return q;
 }
}}));
afterEach(()=>{cleanup();rpc.mockReset();});
it('main campaign detail opens the same historical review, without duplicate initial approval or send controls',async()=>{
 rpc.mockImplementation(async(name:string)=>{
  if(name==='get_campaign_legacy_second')return {data:null,error:null};
  if(name==='review_campaign_legacy_second')return {data:{campaign_id:'historical',fingerprint:'fp',policy:{version:'barberias-prospect-second-v1',waitSeconds:604800,subject:'Conseguiu conhecer o Barberias?',text:'Approved base text',format:'text_only'},recipients:[{recipient_id:'r',contact_id:'c',email:'synthetic@example.invalid',reasons:[],parent:{subject:'Original ledger subject',text:'Original ledger offer',delivered_at:'2026-10-01'},message:{subject:'Conseguiu conhecer o Barberias?',text:'Approved rendered second'}}]},error:null};
  throw Error('Unexpected RPC '+name);
 });
 await act(async()=>{render(<Suspense fallback={<p>Loading</p>}><CampaignDetail params={Promise.resolve({id:'historical'})} /></Suspense>);});
 fireEvent.click(await screen.findByRole('button',{name:'Conferir impedimentos da segunda etapa'}));
 expect(await screen.findByText('Original ledger offer')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Preparar rascunho histórico'})).toBeTruthy();
 expect(screen.queryByText('Initial approval pane')).toBeNull();
 expect(screen.queryByRole('button',{name:/Enviar|Ativar/})).toBeNull();
});
