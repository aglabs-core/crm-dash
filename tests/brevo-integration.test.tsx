import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrevoMessageLink } from '@/components/BrevoMessageLink';
const api=vi.hoisted(()=>({rpc:vi.fn(),insert:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:api.rpc,from:()=>({insert:api.insert}),auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}}),getSession:async()=>({data:{session:{access_token:'synthetic-access'}}})}}}));
beforeEach(()=>{api.rpc.mockReset();api.insert.mockReset();api.fetch.mockReset();vi.stubGlobal('fetch',api.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
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
