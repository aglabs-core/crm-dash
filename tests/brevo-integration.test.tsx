import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Integrations from '@/app/(dashboard)/integrations/page';
import { BrevoMessageLink } from '@/components/BrevoMessageLink';
const api=vi.hoisted(()=>({rpc:vi.fn(),insert:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:api.rpc,from:()=>({insert:api.insert}),auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}}),getSession:async()=>({data:{session:{access_token:'synthetic-access'}}})}}}));
beforeEach(()=>{api.rpc.mockReset();api.insert.mockReset();api.fetch.mockReset();vi.stubGlobal('fetch',api.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('preparing a connection never presents it as receiving live events',async()=>{
  api.rpc.mockResolvedValueOnce({data:[],error:null}).mockResolvedValueOnce({data:[{id:'synthetic-connection',name:'Brevo',last_received_at:null,total_events:0,pending_events:0,ignored_events:0}],error:null});
  api.insert.mockResolvedValue({error:null});
  const user=userEvent.setup();render(<Integrations/>);
  await user.click(await screen.findByRole('button',{name:'Preparar conexão Brevo'}));
  expect(await screen.findByText(/Preparar o cadastro não ativa o webhook/)).toBeTruthy();
  expect(screen.getByText('Aguardando conexão')).toBeTruthy();expect(api.fetch).not.toHaveBeenCalled();
});
it('external message association calls only the authenticated CRM endpoint and does not send email',async()=>{
  api.fetch.mockResolvedValue({ok:true});const onLinked=vi.fn().mockResolvedValue(undefined);
  const user=userEvent.setup();render(<BrevoMessageLink recipientId="synthetic-recipient" onLinked={onLinked}/>);
  await user.click(screen.getByRole('button',{name:'Vincular envio externo'}));
  await user.type(screen.getByLabelText('ID da mensagem na Brevo'),'synthetic-message');
  await user.click(screen.getByRole('button',{name:'Salvar vínculo'}));
  await waitFor(()=>expect(onLinked).toHaveBeenCalledOnce());
  expect(api.fetch).toHaveBeenCalledOnce();
  expect(api.fetch).toHaveBeenCalledWith('/api/integrations/brevo/associate',expect.objectContaining({method:'POST',headers:expect.objectContaining({Authorization:'Bearer synthetic-access'}),body:JSON.stringify({recipient_id:'synthetic-recipient',message_id:'synthetic-message'})}));
});
