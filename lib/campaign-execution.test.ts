import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync} from 'node:fs';
import {providerKeyDigest} from './campaign-brevo';
import {handleCampaignExecution} from './campaign-execution';
const owner='10000000-0000-0000-0000-000000000001';
const item='30000000-0000-0000-0000-000000000001';
const dispatch='40000000-0000-0000-0000-000000000001';
const message={from:'sender@example.test',replyTo:'support@example.test',to:'recipient@example.test',subject:'Approved',text:'Frozen text'};
const request=()=>new Request('https://crm.example.test/api/campaigns/second/execute',{method:'POST',headers:{Authorization:'Bearer synthetic-owner-session'}});
function fixture(options:{mismatch?:boolean;startDenied?:boolean;uncertain?:boolean;foreign?:boolean;connection?:unknown}={}) {
  const calls:string[]=[]; let state='new';
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)); calls.push(url.pathname);
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(url.pathname==='/auth/v1/user')return Response.json({id:options.foreign?'foreign':owner});
    if(url.pathname==='/rest/v1/email_provider_connections')return Response.json(options.connection===undefined?{id:'20000000-0000-0000-0000-000000000001',user_id:owner,provider:'brevo'}:options.connection);
    if(url.pathname==='/rest/v1/email_campaign_batch_recipients')return Response.json({second_message:{...message,...(options.mismatch?{from:'wrong@example.test'}:{})}});
    if(url.pathname.endsWith('/list_campaign_second_work'))return Response.json(body.p_mode==='reconcile'?[{id:dispatch}]:[{item_id:item}]);
    if(url.pathname.endsWith('/claim_campaign_second_dispatch'))return Response.json(state==='new'?{status:'claimed',id:dispatch,token:'token'}:{status:state,id:dispatch});
    if(url.pathname.endsWith('/start_campaign_dispatch')){state=options.startDenied?'review':'dispatch_started';return Response.json({status:state,message});}
    if(url.host==='api.brevo.com'){if(options.uncertain)throw Error('synthetic timeout after acceptance');return Response.json({messageId:'<id@smtp-relay.mailin.fr>'},{status:201});}
    if(url.pathname.endsWith('/finish_campaign_dispatch')){state=body.p_provider_id?'accepted':'uncertain';return Response.json({status:state,id:dispatch});}
    if(url.pathname.endsWith('/publish_campaign_second_dispatch'))return Response.json({status:'published',message_id:'opaque-ledger-id'});
    throw Error('Unexpected synthetic request');
  };
  return {calls,transport};
}
test('mismatched frozen sender is rejected before claim',async()=>{
  const f=fixture({mismatch:true}); const result=await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.equal(result.status,503);
  assert.ok(!f.calls.some(p=>p.endsWith('/claim_campaign_second_dispatch')));
});
const env={CRM_CAMPAIGN_SECOND_ENABLED:'true',CRM_CAMPAIGN_BATCH_LIMIT:'1',NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',BREVO_API_KEY:'synthetic-key',CRM_CAMPAIGN_BREVO_BINDING:JSON.stringify({ownerId:'10000000-0000-0000-0000-000000000001',connectionId:'20000000-0000-0000-0000-000000000001',provider:'brevo',sourceKey:'crm.campaign.second',from:'sender@example.test',replyTo:'support@example.test',keySha256:providerKeyDigest('synthetic-key')})};
test('default off ignores forged activation and performs zero I/O',async()=>{
  const f=fixture(); const result=await handleCampaignExecution(new Request('https://crm.example.test/?enabled=true',{method:'POST',body:'{"enabled":true,"ownerId":"forged"}'}),'send',{env:{},transport:f.transport});
  assert.deepEqual(await result.json(),{status:'disabled'});assert.deepEqual(f.calls,[]);
});
test('invalid server binding or key is rejected before authentication I/O',async()=>{
  for(const patch of [{CRM_CAMPAIGN_BREVO_BINDING:undefined},{CRM_CAMPAIGN_BREVO_BINDING:'null'},{CRM_CAMPAIGN_BREVO_BINDING:'{}'},{CRM_CAMPAIGN_BREVO_BINDING:'invalid'},{BREVO_API_KEY:''},{BREVO_API_KEY:'wrong-key'},{CRM_CAMPAIGN_BATCH_LIMIT:'201'}]) {
    const f=fixture();const result=await handleCampaignExecution(request(),'send',{env:{...env,...patch},transport:f.transport});
    assert.equal(result.status,503);assert.deepEqual(f.calls,[]);
  }
});
test('foreign verified session cannot use approved owner binding',async()=>{
  const f=fixture({foreign:true});const result=await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.equal(result.status,403);assert.deepEqual(f.calls,['/auth/v1/user']);
});
test('missing or mismatched connection never reads customer work',async()=>{
  for(const connection of [null,{}, {id:'foreign',user_id:owner,provider:'brevo'},{id:'20000000-0000-0000-0000-000000000001',user_id:'foreign',provider:'brevo'}]) {
    const f=fixture({connection});const result=await handleCampaignExecution(request(),'send',{env,transport:f.transport});
    assert.equal(result.status,503);assert.equal(f.calls.length,2);
  }
});
test('forged configuration body is not accepted even with owner token',async()=>{
  const f=fixture();const result=await handleCampaignExecution(new Request('https://crm.example.test/',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:'{"ownerId":"forged","url":"https://evil.test"}'}),'send',{env,transport:f.transport});
  assert.equal(result.status,400);assert.deepEqual(f.calls,[]);
});
test('start revalidation denial prevents provider networking',async()=>{
  const f=fixture({startDenied:true});const result=await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.equal(result.status,200);assert.ok(f.calls.some(p=>p.endsWith('/start_campaign_dispatch')));assert.ok(!f.calls.includes('/v3/smtp/email'));
});
test('accepted send publishes once and repeated execution never resends',async()=>{
  const f=fixture();const first=await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.deepEqual(await first.json(),{status:'complete',processed:1,outcomes:[{status:'accepted',ledger:'published'}]});
  assert.ok(f.calls.some(p=>p.endsWith('/publish_campaign_second_dispatch')));
  await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.equal(f.calls.filter(p=>p==='/v3/smtp/email').length,1);
});
test('timeout after dispatch marks uncertainty and repeated execution never resends',async()=>{
  const f=fixture({uncertain:true});await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  await handleCampaignExecution(request(),'send',{env,transport:f.transport});
  assert.equal(f.calls.filter(p=>p==='/v3/smtp/email').length,1);assert.ok(!f.calls.some(p=>p.endsWith('/publish_campaign_second_dispatch')));
});
test('accepted reconciliation works while off without provider key or customer read',async()=>{
  const f=fixture();const result=await handleCampaignExecution(request(),'reconcile',{env:{...env,CRM_CAMPAIGN_SECOND_ENABLED:'false',BREVO_API_KEY:undefined},transport:f.transport});
  assert.deepEqual(await result.json(),{status:'complete',processed:1,outcomes:[{status:'published'}]});
  assert.ok(f.calls.some(p=>p.endsWith('/publish_campaign_second_dispatch')));
  assert.ok(!f.calls.includes('/v3/smtp/email'));assert.ok(!f.calls.some(p=>p.endsWith('/claim_campaign_second_dispatch')));assert.ok(!f.calls.includes('/rest/v1/email_campaign_batch_recipients'));
});
test('Next entrypoint is wired and dormant with no configuration',async()=>{
  const route=existsSync(new URL('../app/api/campaigns/second/execute/route.ts',import.meta.url))?await import('../app/api/campaigns/second/execute/route'): {POST:async()=>new Response(null,{status:404})};
  const previous=process.env.CRM_CAMPAIGN_SECOND_ENABLED;delete process.env.CRM_CAMPAIGN_SECOND_ENABLED;
  try {const result=await route.POST(request());assert.equal(result.status,200);assert.deepEqual(await result.json(),{status:'disabled'});}finally{if(previous===undefined)delete process.env.CRM_CAMPAIGN_SECOND_ENABLED;else process.env.CRM_CAMPAIGN_SECOND_ENABLED=previous;}
});
test('enabled endpoint rejects missing authentication before any network',async()=>{
  const handler=existsSync(new URL('./campaign-execution.ts',import.meta.url))?(await import('./campaign-execution')).handleCampaignExecution:async()=>Response.json({status:'disabled'});
  let calls=0;
  const result=await handler(new Request('https://crm.example.test/api/campaigns/second/execute',{method:'POST'}),'send',{env,transport:async()=>{calls++;throw Error('No network');}});
  assert.equal(result.status,401);assert.equal(calls,0);
});
