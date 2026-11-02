// Disposable PostgreSQL + loopback HTTP only. No production env is loaded.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const container = `crm-executor-proof-${process.pid}`;
const image = 'postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const owner='c14f0f92-ac71-47d8-a1b6-52da1d83aba9', other='22222222-2222-4222-8222-222222222222';
const tenant='0af00833-c1f7-42f4-9543-a5e0ff6f55fc', prospect='44444444-4444-4444-8444-444444444444';
const campaign='55555555-5555-4555-8555-555555555555', recipient='77777777-7777-4777-8777-777777777777';
const connection='33333333-3333-4333-8333-333333333333';
const docker=(...args)=>execFileSync('sudo',['-n','docker',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=(text)=>docker('exec','-i',container,'psql','-U','postgres','-d','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',text).trim();
const lit=(value)=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const actor=(text,user=owner)=>sql(`SET ROLE authenticated; SET request.jwt.claim.sub=${lit(user)}; ${text}`);
const json=(text,user=owner)=>JSON.parse(actor(text,user).split('\n').at(-1));
let batch, item;
let disposableVolumes=[];
let calls=0, mode='accept', observed;
const server=createServer(async(req,res)=>{
  let body=''; for await(const chunk of req)body+=chunk;
  calls++; observed=JSON.parse(body);
  assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'), 'dispatch_started');
  if(mode==='timeout'){await new Promise(r=>setTimeout(r,1500));}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({messageId:mode==='malformed'?true:`synthetic-${calls}`}));
});
async function setup(){
  // Same reduced baseline used by the ledger tests; all domain migrations below are real.
  const source=readFileSync('lib/email-ledger-db.test.ts','utf8');
  const start=source.indexOf('await db.exec(`CREATE ROLE anon;')+'await db.exec(`'.length;
  const end=source.indexOf('`);',start);
  const values={tenant,other,admin:owner,prospect};
  sql(source.slice(start,end).replace(/\$\{(\w+)\}/g,(_,key)=>values[key]));
  const files=['20261016052215_email_campaign_observability.sql','20261017034819_guided_campaign_preparation.sql','20261017160727_brevo_event_receiver.sql','20261017173524_campaign_approval_queue.sql','20261022120000_unified_email_ledger.sql','20261022130000_account_access_reconciliation.sql','20261022184326_maia_email_ledger_bridge_v1.sql','20261102183000_guard_email_ledger_bindings.sql','20261102183500_campaign_followup_review.sql'];
  for(const file of files)sql(readFileSync(`supabase/migrations/${file}`,'utf8'));
  sql(`CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,user_id uuid,product text,status text,net_amount numeric);
    INSERT INTO public.email_provider_connections(id,user_id,name) VALUES('${connection}','${owner}','Synthetic');
    INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,reply_to,subject,content_text,audience_basis) VALUES('${campaign}','${owner}','Synthetic only','barberias','brevo','sender@example.invalid','reply@example.invalid','Olá {{nome}}','Template sintético aprovado para {{produto}}','individual_review');
    INSERT INTO public.email_campaign_recipients(id,campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES('${recipient}','${campaign}','${owner}','${prospect}','dono@barbearia.example.invalid','Synthetic review only');`);
  const review=json(`SELECT public.review_email_campaign_batch('${campaign}')`);
  batch=actor(`SELECT public.approve_email_campaign_batch('${campaign}','${review.fingerprint}',gen_random_uuid(),'Synthetic exact approved message')`);
  item=sql('SELECT id FROM public.email_campaign_batch_recipients');
}
let passed=0;
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
try{
  docker('run','--rm','-d','--name',container,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',image);
  disposableVolumes=JSON.parse(docker('inspect',container))[0].Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);
  for(let i=0;i<100;i++){
    try{if(docker('exec','--user','postgres',container,'readlink','/proc/1/exe').trim().endsWith('/postgres')&&sql('SELECT 1')==='1')break;}catch{}
    if(i===99)throw Error('PostgreSQL final server unavailable');await new Promise(r=>setTimeout(r,100));
  }
  await setup();
  const migration='supabase/migrations/20261102200000_dormant_campaign_executor.sql';
  if(existsSync(migration))sql(readFileSync(migration,'utf8'));
  // Behavioral RED can run before implementation, without import/SQL errors.
  await check('durable executor schema is installed',()=>{
    assert.equal(sql("SELECT to_regclass('crm_campaign_private.dispatch_outbox') IS NOT NULL"),'t');
  });
  const { executeOne, httpProvider }=await import('../lib/campaign-executor.mjs');
  const rpc=async(name,args)=>json(`SELECT public.${name}(${args.map(lit).join(',')})`);
  const run=(enabled=true)=>executeOne({enabled,rpc,provider:httpProvider({url:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000}),itemId:item});
  const claim=()=>rpc('claim_campaign_dispatch',[item]);
  const reset=()=>{sql('TRUNCATE crm_campaign_private.dispatch_outbox; UPDATE crm_campaign_private.dispatch_control SET enabled=true,wait_seconds=1; UPDATE public.email_campaign_batches SET approved_at=now()-interval \'1 hour\',state=\'approved\';');};
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await check('flag off prevents claims and network in both layers',async()=>{
    assert.equal((await run(false)).status,'disabled');assert.equal(calls,0);
    assert.equal((await claim()).status,'disabled');assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');
  });
  await check('missing explicit interval prevents admission',async()=>{
    sql('UPDATE crm_campaign_private.dispatch_control SET enabled=true');
    assert.equal((await claim()).status,'unconfigured');assert.equal(calls,0);
    reset();
  });
  await check('one authorized frozen message has durable accepted receipt; replay never resends',async()=>{
    const r=await run(); assert.equal(r.status,'accepted');assert.equal(calls,1);
    assert.equal(observed.text,'Template sintético aprovado para barberias');
    assert.equal(observed.to,'dono@barbearia.example.invalid');
    assert.equal((await run()).status,'accepted');assert.equal(calls,1);
    assert.equal(sql('SELECT receipt->>\'provider_message_id\' FROM crm_campaign_private.dispatch_outbox'),'synthetic-1');
  });
  await check('timeout after local acceptance is uncertain and never resent',async()=>{
    reset();mode='timeout';const before=calls;
    assert.equal((await run()).status,'uncertain');assert.equal(calls,before+1);
    assert.equal((await run()).status,'uncertain');assert.equal(calls,before+1);mode='accept';
  });
  await check('claims serialize across independent PostgreSQL connections',async()=>{
    reset();
    const query=`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'; SELECT public.claim_campaign_dispatch('${item}');`;
    const concurrent=()=>new Promise((resolve,reject)=>{
      const child=spawn('sudo',['-n','docker','exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',query]);
      let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('exit',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error(err)));
    });
    const results=await Promise.all(Array.from({length:8},concurrent));
    assert.equal(results.filter(r=>r.status==='claimed').length,1);assert.equal(results.filter(r=>r.status==='busy').length,7);
    assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'1');
  });
  await check('expired pre-effect claim retries safely and fences old attempt',async()=>{
    reset();const first=await claim();sql("UPDATE crm_campaign_private.dispatch_outbox SET lease_until=now()-interval '1 second'");
    const second=await claim();assert.equal(second.status,'claimed');assert.notEqual(second.token,first.token);
    assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'fenced');
    assert.equal((await rpc('release_campaign_dispatch',[second.id,second.token])).status,'ready');
    const before=calls;assert.equal((await run()).status,'accepted');assert.equal(calls,before+1);
  });
  await check('revocation after claim blocks dispatch before HTTP',async()=>{
    reset();const first=await claim();actor(`SELECT public.set_email_campaign_batch_state('${batch}','paused')`);
    const before=calls;assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'review');assert.equal(calls,before);
  });
  await check('database flag off after claim blocks start and network',async()=>{
    reset();const first=await claim();sql('UPDATE crm_campaign_private.dispatch_control SET enabled=false');
    assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'disabled');
    assert.equal((await run()).status,'disabled');assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'claimed');
  });
  await check('authenticated foreign owner cannot claim or finish',async()=>{
    reset();assert.throws(()=>json(`SELECT public.claim_campaign_dispatch('${item}')`,other));const first=await claim();
    assert.throws(()=>json(`SELECT public.start_campaign_dispatch('${first.id}','${first.token}')`,other));
    assert.throws(()=>json(`SELECT public.finish_campaign_dispatch('${first.id}','${first.token}','forged')`,other));
    assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'claimed');
    assert.throws(()=>actor('SELECT * FROM crm_campaign_private.dispatch_outbox'));
    assert.equal(sql("SELECT has_table_privilege('service_role','crm_campaign_private.dispatch_outbox','UPDATE')"),'f');
  });
  await check('provider preflight failure has zero durable claim and no HTTP',async()=>{
    reset();const before=calls;
    await assert.rejects(executeOne({enabled:true,rpc,itemId:item,provider:httpProvider({url:'not a URL',timeoutMs:1000})}));
    assert.equal(calls,before);assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');
  });
  for(const [label,change,restore,status] of [
    ['trial',"UPDATE public.contacts SET account_status='trial_encerrado'","UPDATE public.contacts SET account_status=NULL",'account'],
    ['optout',"UPDATE public.contacts SET outreach_status='blocked'","UPDATE public.contacts SET outreach_status='contactable'",'ineligible'],
    ['payment',`INSERT INTO public.payment_transactions(contact_id,user_id,product,status,net_amount) VALUES('${prospect}','${tenant}','barberias','paid',49)`,'DELETE FROM public.payment_transactions','payment'],
    ['provider suppression',`INSERT INTO public.email_provider_suppressions(connection_id,address_key,reason,last_event_at) VALUES('${connection}',public.brevo_address_key('${connection}','dono@barbearia.example.invalid'),'unsubscribed',now())`,'DELETE FROM public.email_provider_suppressions','ineligible'],
    ['interval',"UPDATE public.email_campaign_batches SET approved_at=now()","UPDATE public.email_campaign_batches SET approved_at=now()-interval '1 hour'",'interval'],
    ['prior provider effect',"UPDATE public.email_campaign_recipients SET provider_message_id='synthetic-existing'",'UPDATE public.email_campaign_recipients SET provider_message_id=NULL','prior_campaign_effect'],
  ]){
    await check(`${label} is rechecked before claim and after claim`,async()=>{
      reset();const before=calls;sql(change);assert.equal((await claim()).status,status);assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');sql(restore);
      const first=await claim();sql(change);assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'review');assert.equal(calls,before);sql(restore);
    });
  }
  await check('canonical contact retarget after claim is fenced even with same address',async()=>{
    reset();const first=await claim();
    sql(`INSERT INTO public.contacts(id,user_id,name,email,status,origin,produto,prospecting_pool,outreach_status) VALUES('${other}','${owner}','Synthetic replacement','dono@barbearia.example.invalid','Arquivado','prospeccao','barberias',true,'contactable'); UPDATE public.email_campaign_recipients SET contact_id='${other}';`);
    assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'review');
    sql(`UPDATE public.email_campaign_recipients SET contact_id='${prospect}'; DELETE FROM public.contacts WHERE id='${other}'`);
  });
  await check('malformed HTTP acceptance receipt is uncertain, not successful or retryable',async()=>{
    reset();mode='malformed';const before=calls;assert.equal((await run()).status,'uncertain');assert.equal(calls,before+1);
    assert.equal((await run()).status,'uncertain');assert.equal(calls,before+1);mode='accept';
  });
  await check('unknown start commit and unknown receipt commit never trigger another HTTP',async()=>{
    reset();let before=calls;
    const startLoss=async(name,args)=>{const result=await rpc(name,args);if(name==='start_campaign_dispatch')throw Error('synthetic lost start response');return result;};
    const provider=httpProvider({url:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000});
    await assert.rejects(executeOne({enabled:true,rpc:startLoss,provider,itemId:item}));assert.equal(calls,before);
    assert.equal((await run()).status,'dispatch_started');assert.equal(calls,before);
    reset();before=calls;
    const finishLoss=async(name,args)=>{const result=await rpc(name,args);if(name==='finish_campaign_dispatch')throw Error('synthetic lost receipt response');return result;};
    assert.equal((await executeOne({enabled:true,rpc:finishLoss,provider,itemId:item})).status,'uncertain');
    assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'accepted');
    assert.equal((await run()).status,'accepted');assert.equal(calls,before+1);
  });
  await check('inbound response and prior prospecting ledger history stop new mail',async()=>{
    for(const direction of ['inbound','outbound']){
      reset();const before=calls;
      const change=`INSERT INTO public.email_messages(user_id,contact_id,direction,provider,category,source_key,address,subject,provider_message_id,sent_at) VALUES('${tenant}','${prospect}','${direction}','brevo','prospeccao','synthetic.proof','dono@barbearia.example.invalid','Synthetic only','history-proof',now())`;
      sql(change);assert.equal((await claim()).status,'history');sql('DELETE FROM public.email_messages');
      const first=await claim();sql(change);assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'review');sql('DELETE FROM public.email_messages');assert.equal(calls,before);
    }
  });
  await check('duplicate address in another approved campaign cannot acquire another send',async()=>{
    reset();assert.equal((await claim()).status,'claimed');
    const second=sql(`INSERT INTO public.email_campaigns(user_id,name,product,provider,sender_email,subject,content_text,audience_basis) VALUES('${owner}','Synthetic duplicate','barberias','brevo','sender@example.invalid','Synthetic','Synthetic','individual_review') RETURNING id`);
    sql(`INSERT INTO public.email_campaign_recipients(campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES('${second}','${owner}','${prospect}','dono@barbearia.example.invalid','Synthetic duplicate review')`);
    const review=json(`SELECT public.review_email_campaign_batch('${second}')`);
    const secondBatch=actor(`SELECT public.approve_email_campaign_batch('${second}','${review.fingerprint}',gen_random_uuid(),'Synthetic duplicate approval')`);
    sql(`UPDATE public.email_campaign_batches SET approved_at=now()-interval '1 hour' WHERE id='${secondBatch}'`);
    const secondItem=sql(`SELECT id FROM public.email_campaign_batch_recipients WHERE batch_id='${secondBatch}'`);
    assert.equal((await rpc('claim_campaign_dispatch',[secondItem])).status,'duplicate');
    assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'1');
  });
  await check('post-start completion cannot be overwritten or released',async()=>{
    reset();const first=await claim();assert.equal((await rpc('start_campaign_dispatch',[first.id,first.token])).status,'dispatch_started');
    assert.equal((await rpc('release_campaign_dispatch',[first.id,first.token])).status,'fenced');
    assert.equal((await rpc('finish_campaign_dispatch',[first.id,first.token,null])).status,'uncertain');
    assert.equal((await rpc('finish_campaign_dispatch',[first.id,first.token,'late-acceptance'])).status,'fenced');
    assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'uncertain');
  });
  await check('real worker SIGKILL after HTTP acceptance plus PostgreSQL restart never resends',async()=>{
    reset();const before=calls;
    const code=`import {execFileSync} from 'node:child_process';import {executeOne,httpProvider} from './lib/campaign-executor.mjs';
      const rpc=async(name,args)=>{const quote=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";const q="SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'; SELECT public."+name+"("+args.map(quote).join(',')+");";return JSON.parse(execFileSync('sudo',['-n','docker','exec','-i','${container}','psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q],{encoding:'utf8'}).trim());};
      const p=httpProvider({url:'http://127.0.0.1:${server.address().port}',timeoutMs:1000});const send=p.send;p.send=async(m)=>{await send(m);process.kill(process.pid,'SIGKILL');};await executeOne({enabled:true,rpc,provider:p,itemId:'${item}'});`;
    const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',d=>errors+=d);
    const outcome=await new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));
    assert.equal(outcome.signal,'SIGKILL',errors);assert.equal(calls,before+1);assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'dispatch_started');
    docker('restart',container);
    for(let attempt=0;attempt<100;attempt++){
      try{if(sql('SELECT 1')==='1')break;}catch{}
      if(attempt===99)throw Error('PostgreSQL restart readiness timed out');await new Promise(r=>setTimeout(r,100));
    }
    sql("UPDATE crm_campaign_private.dispatch_outbox SET lease_until=now()-interval '1 second'");
    assert.equal((await run()).status,'uncertain');assert.equal(calls,before+1);assert.equal(sql('SELECT state FROM crm_campaign_private.dispatch_outbox'),'uncertain');
  });
  mkdirSync('evidence/campaign-executor',{recursive:true});
  writeFileSync('evidence/campaign-executor/last-run.json',JSON.stringify({passed,providerRequests:calls,image},null,2)+'\n');
  console.log(`RESULT ${passed} checks, ${calls} local HTTP requests`);
}finally{
  await new Promise(r=>server.close(r));
  try{docker('rm','-f','-v',container);}catch{}
  // Explicit removal handles Docker versions where rm -f bypasses --rm volume cleanup.
  for(const volume of disposableVolumes){
    try{docker('volume','inspect',volume);docker('volume','rm',volume);}catch{}
  }
  assert.equal(docker('ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}').trim(),'');
  for(const volume of disposableVolumes)assert.throws(()=>docker('volume','inspect',volume));
  console.log('CLEANUP disposable container and exact anonymous volumes removed; no published ports');
}
