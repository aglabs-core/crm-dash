// Real isolated PostgreSQL 17; no dotenv, provider keys or production writes.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {executeOne,httpProvider} from '../lib/campaign-executor.mjs';
const container=`crm-legacy-second-${process.pid}`;
const image='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const owner='c14f0f92-ac71-47d8-a1b6-52da1d83aba9',other='22222222-2222-4222-8222-222222222222',tenant='0af00833-c1f7-42f4-9543-a5e0ff6f55fc',prospect='44444444-4444-4444-8444-444444444444';
const campaign='55555555-5555-4555-8555-555555555555',recipient='77777777-7777-4777-8777-777777777777';
const docker=(...a)=>execFileSync('sudo',['-n','docker',...a],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
const sql=q=>docker('exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q).trim();
const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
const actor=(q,u=owner)=>sql(`SET ROLE authenticated;SET request.jwt.claim.sub=${lit(u)};${q}`);
const rpc=(name,args,u=owner)=>JSON.parse(actor(`SELECT public.${name}(${args.map(lit).join(',')})`,u));
let volumes=[],passed=0;
const check=async(n,fn)=>{await fn();passed++;console.log('PASS '+n);};
try {
 docker('run','--rm','-d','--name',container,'--network','none','-e','POSTGRES_HOST_AUTH_METHOD=trust',image);
 volumes=JSON.parse(docker('inspect',container))[0].Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);
 for(let i=0;i<100;i++){try{if(docker('exec','--user','postgres',container,'readlink','/proc/1/exe').trim().endsWith('/postgres')&&sql('SELECT 1')==='1')break;}catch{}if(i===99)throw Error('PG unavailable');await new Promise(r=>setTimeout(r,100));}
 const source=readFileSync('lib/email-ledger-db.test.ts','utf8');const start=source.indexOf('await db.exec(`CREATE ROLE anon;')+'await db.exec(`'.length;
 sql(source.slice(start,source.indexOf('`);',start)).replace(/\$\{(\w+)\}/g,(_,k)=>({tenant,other,admin:owner,prospect})[k]));
 for(const f of ['20261016052215_email_campaign_observability.sql','20261017034819_guided_campaign_preparation.sql','20261017160727_brevo_event_receiver.sql','20261017173524_campaign_approval_queue.sql','20261022120000_unified_email_ledger.sql','20261022130000_account_access_reconciliation.sql','20261022184326_maia_email_ledger_bridge_v1.sql','20261102203246_guard_email_ledger_bindings_20261102183000.sql','20261102203544_campaign_followup_review_20261102183500.sql','20261102200000_dormant_campaign_executor.sql','20261102210000_campaign_second_step.sql','20261102220000_campaign_legacy_second.sql'])if(existsSync('supabase/migrations/'+f))sql(readFileSync('supabase/migrations/'+f,'utf8'));
 sql(`CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,user_id uuid,product text,status text,net_amount numeric);
 INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,reply_to,subject,content_text,audience_basis) VALUES('${campaign}','${owner}','Historical','barberias','brevo','current@example.invalid','current-reply@example.invalid','MUTABLE CURRENT SUBJECT','MUTABLE CURRENT OFFER','individual_review');
 INSERT INTO public.email_campaign_recipients(id,campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES('${recipient}','${campaign}','${owner}','${prospect}','dono@barbearia.example.invalid','Original reviewed recipient');
 INSERT INTO public.email_messages(user_id,contact_id,direction,provider,category,source_key,product,campaign_id,recipient_id,address,from_address,reply_to,subject,body_text,provider_message_id,sent_at,delivered_at,status) VALUES('${tenant}','${prospect}','outbound','brevo','prospeccao','legacy.initial','barberias','${campaign}','${recipient}','dono@barbearia.example.invalid','original@example.invalid','original-reply@example.invalid','ORIGINAL SUBJECT','ORIGINAL OFFER','legacy-proof',now()-interval '30 days',now()-interval '8 days','delivered');`);
 console.log('POSTGRES '+sql('SHOW server_version'));
 sql(`INSERT INTO public.contacts(id,user_id,name,email,status,origin,produto,prospecting_pool,outreach_status) VALUES('99999999-9999-4999-8999-999999999999','${owner}','Missing delivery','missing@example.invalid','Arquivado','prospeccao','barberias',true,'contactable');
 INSERT INTO public.email_campaign_recipients(id,campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES('99999999-9999-4999-8999-999999999998','${campaign}','${owner}','99999999-9999-4999-8999-999999999999','missing@example.invalid','Reviewed but no initial evidence');`);
 await check('behavioral schema gate: historical draft preparation exists',()=>assert.equal(sql("SELECT to_regprocedure('public.prepare_campaign_legacy_second(uuid,text)') IS NOT NULL"),'t'));
 const review=()=>rpc('review_campaign_legacy_second',[campaign]);
 let r=review(),batch,item;
 await check('legacy review uses original ledger evidence and exact approved policy, not current offer',()=>{
  assert.equal(r.recipients.length,2);assert.ok(r.recipients[1].reasons.includes('missing_delivery'));assert.deepEqual(r.recipients[0].reasons,[]);assert.equal(r.recipients[0].parent.subject,'ORIGINAL SUBJECT');assert.equal(r.policy.waitSeconds,604800);assert.equal(r.policy.subject,'Conseguiu conhecer o Barberias?');
 });
 await check('same-campaign simultaneous preparations converge on first creation',async()=>{
  const q=`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'; SELECT public.prepare_campaign_legacy_second('${campaign}','${r.fingerprint}');`;
  const one=()=>new Promise((resolve,reject)=>{let out='',err='';const p=spawn('sudo',['-n','docker','exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q]);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c?reject(Error(err)):resolve(JSON.parse(out.trim())));});
  const results=await Promise.all(Array.from({length:4},one));assert.ok(results.every(x=>x.batch_id===results[0].batch_id));assert.equal(sql('SELECT count(*) FROM public.email_campaign_batches'),'1');
 });
 await check('preparation idempotently freezes draft without initial approval or outbox',()=>{
  batch=rpc('prepare_campaign_legacy_second',[campaign,r.fingerprint]).batch_id;
  assert.equal(rpc('prepare_campaign_legacy_second',[campaign,r.fingerprint]).batch_id,batch);
  assert.equal(sql(`SELECT state FROM public.email_campaign_batches WHERE id='${batch}'`),'draft');
  assert.equal(sql(`SELECT approved_at IS NULL AND second_approval IS NULL FROM public.email_campaign_batches WHERE id='${batch}'`),'t');
  item=sql(`SELECT id FROM public.email_campaign_batch_recipients WHERE batch_id='${batch}' AND recipient_id='${recipient}'`);
  assert.equal(sql(`SELECT content FROM public.email_campaign_batch_recipients WHERE id='${item}'`),'ORIGINAL OFFER');
  assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');
 });
 await check('foreign owner denied and RLS hides draft and recipients',()=>{
  assert.throws(()=>rpc('review_campaign_legacy_second',[campaign],other));assert.throws(()=>rpc('prepare_campaign_legacy_second',[campaign,r.fingerprint],other));
  assert.equal(actor('SELECT count(*) FROM public.email_campaign_batches',other),'0');assert.equal(actor('SELECT count(*) FROM public.email_campaign_batch_recipients',other),'0');
 });
 const approve=(fingerprint=r.fingerprint,u=owner)=>rpc('approve_campaign_legacy_second',[batch,fingerprint,JSON.stringify([recipient]),'88888888-8888-4888-8888-888888888888','Owner manually reviewed recipient and exact second text'],u);
 await check('draft cannot be promoted by generic state control or initial approval API',()=>{
  assert.throws(()=>actor(`SELECT public.set_email_campaign_batch_state('${batch}','approved')`));
  assert.throws(()=>rpc('approve_campaign_second_step',[batch,'Other','Other',1,'88888888-8888-4888-8888-888888888888','Not the approved policy']));
 });
 for(const [label,change,restore] of [
  ['missing delivery',"UPDATE public.email_messages SET delivered_at=NULL","UPDATE public.email_messages SET delivered_at=now()-interval '8 days'"],
  ['delivery not send anchor',"UPDATE public.email_messages SET delivered_at=now()-interval '6 days'","UPDATE public.email_messages SET delivered_at=now()-interval '8 days'"],
  ['reply',"UPDATE public.email_messages SET replied_at=now()","UPDATE public.email_messages SET replied_at=NULL"],
  ['trial',"UPDATE public.contacts SET account_status='trial'","UPDATE public.contacts SET account_status=NULL"],
  ['payment',`INSERT INTO public.payment_transactions(contact_id,user_id,product,status,net_amount) VALUES('${prospect}','${tenant}','barberias','paid',49)`,'DELETE FROM public.payment_transactions'],
  ['failure',"UPDATE public.email_messages SET status='failed'","UPDATE public.email_messages SET status='delivered'"],
  ['optout',"UPDATE public.contacts SET outreach_status='blocked'","UPDATE public.contacts SET outreach_status='contactable'"],
 ])await check(label+' excludes recipient and stale approval fails',()=>{sql(change);assert.ok(review().recipients[0].reasons.length);assert.throws(()=>approve());sql(restore);});
 // Restore exact frozen delivery timestamp after deliberately stale probes.
 sql(`UPDATE public.email_messages SET delivered_at=${lit(r.recipients[0].parent.delivered_at)}::timestamptz`);
 await check('identical rendered initial offer is excluded, not resent as second',()=>{
  sql(`UPDATE public.email_messages SET body_text=${lit(r.recipients[0].message.text)}`);
  assert.ok(review().recipients[0].reasons.includes('repeated_initial_text'));
  sql("UPDATE public.email_messages SET body_text='ORIGINAL OFFER'");
 });
 await check('foreign owner and stale fingerprint cannot approve',()=>{assert.throws(()=>approve(r.fingerprint,other));assert.throws(()=>approve('0'.repeat(64)));});
 await check('snapshot and base-content policy match the exact approved JSON document',()=>{
  const p=JSON.parse(readFileSync('docs/campaign-second-policy.json','utf8'));
  for(const k of ['version','waitSeconds','subject','text','format'])assert.equal(r.policy[k],p[k]);
  const saved=rpc('get_campaign_legacy_second',[campaign]);assert.equal(saved.id,batch);assert.deepEqual(saved.review,r);
  assert.deepEqual(rpc('campaign_batch_overview',[campaign]),[]);
  assert.throws(()=>rpc('get_campaign_legacy_second',[campaign],other));
 });
 await check('blocked, duplicate and foreign recipient selections cannot approve',()=>{
  for(const selection of [['99999999-9999-4999-8999-999999999998'],[recipient,recipient],[other]])assert.throws(()=>rpc('approve_campaign_legacy_second',[batch,r.fingerprint,JSON.stringify(selection),'88888888-8888-4888-8888-888888888888','Owner reviewed exact recipient selection']));
 });
 await check('simultaneous identical manual approvals converge without creating any dispatch',async()=>{
  const q=`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'; SELECT public.approve_campaign_legacy_second('${batch}','${r.fingerprint}','["${recipient}"]'::jsonb,'88888888-8888-4888-8888-888888888888','Owner manually reviewed recipient and exact second text');`;
  const one=()=>new Promise((resolve,reject)=>{let out='',err='';const p=spawn('sudo',['-n','docker','exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q]);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c?reject(Error(err)):resolve(JSON.parse(out.trim())));});
  const results=await Promise.all(Array.from({length:4},one));assert.ok(results.every(x=>x.status==='approved'&&x.batch_id===batch));assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');
 });
 await check('owner explicit recipient review approves only second and dormant flags remain off',()=>{
  assert.equal(approve().status,'approved');assert.equal(approve().status,'approved');
  assert.equal(sql('SELECT enabled FROM crm_campaign_private.dispatch_control'),'f');
  assert.equal(rpc('claim_campaign_second_dispatch',[item]).status,'disabled');assert.equal(sql('SELECT count(*) FROM crm_campaign_private.dispatch_outbox'),'0');
 });
 await check('schema independently rejects null cold-pool eligibility',()=>{
  assert.throws(()=>sql('UPDATE public.contacts SET prospecting_pool=NULL'));
 });
 await check('legacy claims serialize; parent changes after claim fence start with no effect',async()=>{
  sql('UPDATE crm_campaign_private.dispatch_control SET enabled=true,wait_seconds=1');
  const blockedItem=sql(`SELECT id FROM public.email_campaign_batch_recipients WHERE batch_id='${batch}' AND recipient_id<>'${recipient}'`);
  assert.equal(rpc('claim_campaign_second_dispatch',[blockedItem]).status,'second_unapproved');
  const q=`SET ROLE authenticated;SET request.jwt.claim.sub='${owner}'; SELECT public.claim_campaign_second_dispatch('${item}');`;
  const one=()=>new Promise((resolve,reject)=>{let out='',err='';const p=spawn('sudo',['-n','docker','exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q]);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c?reject(Error(err)):resolve(JSON.parse(out.trim())));});
  const results=await Promise.all(Array.from({length:4},one));assert.equal(results.filter(x=>x.status==='claimed').length,1);assert.equal(results.filter(x=>x.status==='busy').length,3);
  const first=results.find(x=>x.status==='claimed');
  sql("UPDATE public.email_messages SET body_text='Altered original evidence'");
  assert.equal(rpc('start_campaign_dispatch',[first.id,first.token]).status,'review');
  assert.equal(sql("SELECT count(*) FROM crm_campaign_private.dispatch_outbox WHERE dispatch_started_at IS NOT NULL"),'0');
  sql("TRUNCATE crm_campaign_private.dispatch_outbox; UPDATE public.email_messages SET body_text='ORIGINAL OFFER'");
 });
 await check('real second runner uses only legacy parent and local HTTP; accepted replay never resends',async()=>{
  sql('UPDATE crm_campaign_private.dispatch_control SET enabled=true,wait_seconds=1');
  assert.equal(rpc('claim_campaign_dispatch',[item]).status,'legacy_second_only');
  let calls=0,observed;
  const server=createServer(async(req,res)=>{let raw='';for await(const x of req)raw+=x;observed=JSON.parse(raw);calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({messageId:'synthetic-second-only'}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const run=()=>executeOne({enabled:true,step:'second',itemId:item,rpc:async(n,a)=>rpc(n,a),provider:httpProvider({url:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000})});
   const result=await run();assert.equal(result.status,'accepted');assert.equal(result.ledger,'published');
   assert.equal(observed.from,'original@example.invalid');assert.equal(observed.subject,r.policy.subject);assert.notEqual(observed.text,'ORIGINAL OFFER');
   assert.equal((await run()).status,'accepted');assert.equal(calls,1);
   assert.equal(sql("SELECT count(*) FROM crm_campaign_private.dispatch_outbox WHERE step='initial'"),'0');
   assert.equal(sql("SELECT in_reply_to_message_id FROM public.email_messages WHERE source_key='crm.campaign.second'"),r.recipients[0].parent.id);
  }finally{await new Promise(r=>server.close(r));}
 });
 await check('same-campaign concurrent preparation replays converge after approval',async()=>{
  // Existing approved historical batch replay must converge under independent connections.
  const q=`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'; SELECT public.prepare_campaign_legacy_second('${campaign}','${r.fingerprint}');`;
  const one=()=>new Promise((resolve,reject)=>{let out='',err='';const p=spawn('sudo',['-n','docker','exec','-i',container,'psql','-U','postgres','-XAtq','-v','ON_ERROR_STOP=1','-c',q]);p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('exit',c=>c?reject(Error(err)):resolve(JSON.parse(out.trim())));});
  const results=await Promise.all(Array.from({length:4},one));assert.ok(results.every(x=>x.batch_id===batch));assert.equal(sql('SELECT count(*) FROM public.email_campaign_batches'),'1');
 });
 console.log(`RESULT ${passed} checks; one synthetic loopback HTTP acceptance; no external provider or production access`);
} finally {
 try{docker('rm','-f','-v',container);}catch{}
 assert.equal(docker('ps','-a','--filter',`name=^/${container}$`,'--format','{{.Names}}').trim(),'');
 for(const v of volumes)assert.throws(()=>docker('volume','inspect',v));
 console.log('CLEANUP container and exact volumes absent');
}
