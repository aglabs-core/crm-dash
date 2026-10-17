import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrevoEvent } from './brevo-events';
import { receiveBrevoWebhook, MAX_WEBHOOK_BYTES, type ReceiverConfig } from './brevo-receiver';
import { associateBrevoMessage } from './brevo-association';
const config:ReceiverConfig={token:'x'.repeat(40),connectionId:'11111111-1111-4111-8111-111111111111',url:'https://synthetic.example.invalid',serviceKey:'synthetic'};
const payload={event:'delivered',email:'Person@example.invalid','message-id':'<message-one>',ts_event:1767225600,id:7};
const request=(body:unknown,token=config.token)=>new Request('https://crm.example.invalid/api/integrations/brevo/webhook',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
test('normalization ignores webhook id, uses UTC and keeps proxy opens separate',()=>{
  const first=normalizeBrevoEvent(payload),second=normalizeBrevoEvent({...payload,id:999});
  assert.equal(first.event_key,second.event_key);assert.equal(first.occurred_at,'2026-01-01T00:00:00.000Z');
  assert.equal(normalizeBrevoEvent({...payload,event:'proxy_open'}).event_type,'proxy_open');
  assert.equal(normalizeBrevoEvent({...payload,event:'soft_bounce'}).event_type,'bounced');
  assert.equal(normalizeBrevoEvent({...payload,event:'hard_bounce'}).provider_type,'hard_bounce');
  assert.equal(normalizeBrevoEvent({...payload,event:'replied'}).event_type,null);
  assert.throws(()=>normalizeBrevoEvent({...payload,ts_event:undefined,date:'2026-01-01 12:00:00'}));
});
test('receiver rejects unauthorized, disabled, oversized and partially malformed batches without persistence',async()=>{
  let calls=0;const deps={config,ingest:async()=>{calls++;}};
  assert.equal((await receiveBrevoWebhook(request(payload,'wrong'),deps)).status,401);
  assert.equal((await receiveBrevoWebhook(request(payload),{...deps,config:{...config,token:''}})).status,503);
  assert.equal((await receiveBrevoWebhook(request('x'.repeat(MAX_WEBHOOK_BYTES+1)),deps)).status,413);
  assert.equal((await receiveBrevoWebhook(request([payload,{}]),deps)).status,400);
  assert.equal(calls,0);
});
test('receiver acknowledges only after durable ingestion and never echoes recipient data',async()=>{
  const successful=await receiveBrevoWebhook(request([payload,payload]),{config,ingest:async(events)=>{assert.equal(events.length,2);}});
  assert.equal(successful.status,200);assert.deepEqual(await successful.json(),{accepted:2});
  const failed=await receiveBrevoWebhook(request(payload),{config,ingest:async()=>{throw new Error('synthetic');}});
  assert.equal(failed.status,503);assert.equal((await failed.text()).includes(payload.email),false);
});
test('association validates the caller on the server and ignores a forged actor id',async()=>{
  let caller='';
  const req=new Request('https://crm.example.invalid/api/integrations/brevo/associate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic-user-token'},body:JSON.stringify({recipient_id:config.connectionId,message_id:'<message-one>',actor_id:'forged'})});
  const result=await associateBrevoMessage(req,{config,authenticate:async()=> 'verified-owner',associate:async(actor,_recipient,message)=>{caller=actor;assert.equal(message,'message-one');return 1;}});
  assert.equal(result.status,200);assert.equal(caller,'verified-owner');
});
