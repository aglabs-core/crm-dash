import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const campaign='33333333-3333-4333-8333-333333333333', contact='44444444-4444-4444-8444-444444444444';
const key='55555555-5555-4555-8555-555555555555', connection='66666666-6666-4666-8666-666666666666';

test('campaign approval freezes reviewed messages, isolates accounts and never sends',async(t)=>{
  const db=new PGlite();
  const actor=async<T>(sql:string,args:unknown[]=[],user=owner)=>{
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${user}';`);
    try{return await db.query<T>(sql,args);}finally{await db.exec('RESET ROLE');}
  };
  type Snapshot={fingerprint:string;recipients:{recipient_id:string;subject:string;content:string;reason:string|null}[]};
  const review=async()=>(await actor<{snapshot:Snapshot}>('SELECT public.review_email_campaign_batch($1) AS snapshot',[campaign])).rows[0].snapshot;
  const approve=async(fingerprint:string,approvalKey=key)=>(await actor<{id:string}>('SELECT public.approve_email_campaign_batch($1,$2,$3,$4) AS id',[campaign,fingerprint,approvalKey,'Reviewed final content and audience'])).rows[0].id;
  let batch=''; let recipient='';
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
      CREATE TABLE public.admin_users(id uuid PRIMARY KEY);GRANT SELECT ON public.admin_users TO authenticated;
      CREATE TABLE public.contacts(id uuid PRIMARY KEY,user_id uuid,name text,email text,produto text,outreach_status text,status text DEFAULT 'Lead');
      ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY owner_contacts ON public.contacts TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
      GRANT ALL ON public.contacts TO authenticated;
      INSERT INTO public.contacts(id,user_id,name,email,produto,outreach_status) VALUES('${contact}','${owner}','Synthetic A','person@example.invalid','barberias','contactable');`);
    for(const file of ['20261016052215_email_campaign_observability.sql','20261017034819_guided_campaign_preparation.sql','20261017160727_brevo_event_receiver.sql','20261017173524_campaign_approval_queue.sql'])await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
    await db.exec(await readFile('supabase/migrations/20261017173524_campaign_approval_queue.sql','utf8'));
    await db.exec(`INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,subject,content_text,audience_basis) VALUES('${campaign}','${owner}','Synthetic','barberias','brevo','sender@example.invalid','Olá {{nome}}','Conheça {{produto}}, {{nome}}','individual_review');
      INSERT INTO public.email_campaign_recipients(campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES('${campaign}','${owner}','${contact}','person@example.invalid','Synthetic evidence');
      INSERT INTO public.email_provider_connections(id,user_id,name) VALUES('${connection}','${owner}','Synthetic');`);
    recipient=(await db.query<{id:string}>('SELECT id FROM public.email_campaign_recipients')).rows[0].id;
    await t.test('changed personalization invalidates the exact review before any snapshot is saved',async()=>{
      const before=await review();assert.equal(before.recipients[0].subject,'Olá Synthetic A');
      await db.query("UPDATE public.contacts SET name='Synthetic B' WHERE id=$1",[contact]);
      await assert.rejects(approve(before.fingerprint),/Review changed/);
      assert.equal((await db.query('SELECT id FROM public.email_campaign_batches')).rows.length,0);
    });
    await t.test('one reviewed version is durable and repeating approval cannot create another version',async()=>{
      const snapshot=await review();batch=await approve(snapshot.fingerprint);
      assert.equal(await approve(snapshot.fingerprint),batch);
      assert.equal((await db.query('SELECT id FROM public.email_campaign_batches')).rows.length,1);
      const rows=await db.query<{subject:string;content:string}>('SELECT subject,content FROM public.email_campaign_batch_recipients');
      assert.equal(rows.rows[0].subject,'Olá Synthetic B');assert.equal(rows.rows[0].content,'Conheça barberias, Synthetic B');
      assert.equal((await db.query('SELECT id FROM public.email_campaign_events')).rows.length,0);
      assert.equal((await db.query<{status:string}>('SELECT status FROM public.contacts')).rows[0].status,'Lead');
      await assert.rejects(approve(snapshot.fingerprint,other),/already approved/);
    });
    await t.test('ownership and direct writes cannot forge approvals or rewrite frozen messages',async()=>{
      const permissions=(await db.query<{insert:boolean;update:boolean;delete:boolean}>("SELECT has_table_privilege('service_role','public.email_campaign_batches','INSERT') AS insert,has_table_privilege('service_role','public.email_campaign_batch_recipients','UPDATE') AS update,has_table_privilege('service_role','public.email_campaign_batches','DELETE') AS delete")).rows[0];
      assert.deepEqual(permissions,{insert:false,update:false,delete:false});
      assert.equal((await actor('SELECT * FROM public.email_campaign_batches',[],other)).rows.length,0);
      await assert.rejects(actor('SELECT public.approve_email_campaign_batch($1,$2,$3,$4)',[campaign,'x',other,'Forged evidence'],other));
      await assert.rejects(actor('SELECT public.set_email_campaign_batch_state($1,$2)',[batch,'cancelled'],other));
      await assert.rejects(actor("UPDATE public.email_campaign_batch_recipients SET content='changed'"));
      await assert.rejects(actor("UPDATE public.email_campaign_batches SET state='cancelled'"));
      await assert.rejects(actor("UPDATE public.email_campaigns SET subject='changed' WHERE id=$1",[campaign]),/Cancel the approved/);
      await assert.rejects(actor('DELETE FROM public.email_campaign_recipients WHERE id=$1',[recipient]),/Cancel the approved/);
    });
    await t.test('new contact blocks appear in the overview without rewriting approved text',async()=>{
      await db.query("UPDATE public.contacts SET name='Synthetic C',outreach_status='blocked' WHERE id=$1",[contact]);
      const row=(await actor<{data:{recipients:{content:string;reason:string}[]}[]}>('SELECT public.campaign_batch_overview($1) AS data',[campaign])).rows[0].data[0];
      assert.equal(row.recipients[0].content,'Conheça barberias, Synthetic B');assert.match(row.recipients[0].reason,/bloqueado/);
      await actor('SELECT public.set_email_campaign_batch_state($1,$2)',[batch,'paused']);
      await assert.rejects(actor("UPDATE public.email_campaigns SET subject='changed' WHERE id=$1",[campaign]),/Cancel the approved/);
      await actor('SELECT public.set_email_campaign_batch_state($1,$2)',[batch,'approved']);
    });
    await t.test('cancel preserves the old version and a new review is required for any replacement',async()=>{
      await actor('SELECT public.set_email_campaign_batch_state($1,$2)',[batch,'cancelled']);
      await assert.rejects(actor('SELECT public.set_email_campaign_batch_state($1,$2)',[batch,'approved']),/immutable/);
      await actor("UPDATE public.email_campaigns SET subject='New {{nome}}' WHERE id=$1",[campaign]);
      await db.query("UPDATE public.contacts SET outreach_status='contactable' WHERE id=$1",[contact]);
      const snapshot=await review();await approve(snapshot.fingerprint,other);
      assert.equal((await db.query('SELECT id FROM public.email_campaign_batches')).rows.length,2);
      assert.equal((await db.query<{subject:string}>('SELECT subject FROM public.email_campaign_batch_recipients WHERE batch_id=$1',[batch])).rows[0].subject,'Olá Synthetic B');
    });
    await t.test('historical external message can still be linked after approval without rewriting snapshots',async()=>{
      await db.exec('SET ROLE service_role');
      await db.query('SELECT public.associate_brevo_message($1,$2,$3,$4)',[connection,owner,recipient,'synthetic-already-sent']);
      await db.exec('RESET ROLE');
      const rows=(await actor<{data:{recipients:{provider_message_id:string;content:string}[]}[]}>('SELECT public.campaign_batch_overview($1) AS data',[campaign])).rows[0].data;
      assert.equal(rows[0].recipients[0].provider_message_id,'synthetic-already-sent');
      assert.equal((await db.query<{content:string}>('SELECT content FROM public.email_campaign_batch_recipients WHERE batch_id=$1',[batch])).rows[0].content,'Conheça barberias, Synthetic B');
      // Remove synthetic message to exercise a new, suppressed preparation below.
      await db.query('UPDATE public.email_campaign_recipients SET provider_message_id=NULL WHERE id=$1',[recipient]);
    });
    await t.test('suppression without campaign association is revalidated in the approval transaction',async()=>{
      await db.exec(`UPDATE public.email_campaign_batches SET state='cancelled';INSERT INTO public.email_provider_suppressions(connection_id,address_key,reason,last_event_at) VALUES('${connection}',public.brevo_address_key('${connection}','person@example.invalid'),'unsubscribed',now());`);
      const snapshot=await review();assert.match(snapshot.recipients[0].reason||'',/descadastro/);
      await assert.rejects(approve(snapshot.fingerprint,connection),/Audience unavailable/);
    });
    await t.test('cancelled snapshots survive audience removal and duplicate addresses cannot be approved',async()=>{
      await db.exec('DELETE FROM public.email_provider_suppressions');
      await actor('DELETE FROM public.email_campaign_recipients WHERE id=$1',[recipient]);
      const history=(await actor<{data:{recipients:{reason:string}[]}[]}>('SELECT public.campaign_batch_overview($1) AS data',[campaign])).rows[0].data;
      assert.equal(history.length,2);assert.match(history[0].recipients[0].reason,/indisponível/);
      await db.exec(`INSERT INTO public.contacts(id,user_id,name,email,produto,outreach_status) VALUES('${connection}','${owner}','Duplicate','person@example.invalid','barberias','contactable');
        INSERT INTO public.email_campaign_recipients(campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES
          ('${campaign}','${owner}','${contact}','person@example.invalid','Synthetic evidence'),('${campaign}','${owner}','${connection}','PERSON@example.invalid','Synthetic evidence');`);
      const snapshot=await review();assert.equal(snapshot.recipients.filter(r=>r.reason==='E-mail repetido').length,2);
      await assert.rejects(approve(snapshot.fingerprint,connection),/Audience unavailable/);
    });
  }finally{await db.exec('RESET ROLE');await db.close();}
});
