import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeBrevoEvent } from './brevo-events';
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const connection='33333333-3333-4333-8333-333333333333', foreignConnection='44444444-4444-4444-8444-444444444444';
const campaign='55555555-5555-4555-8555-555555555555', foreignCampaign='66666666-6666-4666-8666-666666666666';
const recipient='77777777-7777-4777-8777-777777777777', foreignRecipient='88888888-8888-4888-8888-888888888888';
test('Brevo inbox isolates accounts, reconciles early events and suppresses future email without changing contacts', async(t)=>{
  const db=new PGlite();
  const service=async(sql:string,args:unknown[]=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}};
  const event=(type:string,message='message-one')=>normalizeBrevoEvent({event:type,email:'person@example.invalid','message-id':`<${message}>`,ts_event:1767225600});
  const ingest=(item:ReturnType<typeof event>,conn=connection)=>service('SELECT public.ingest_brevo_events($1,$2::jsonb)',[conn,JSON.stringify([item])]);
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
      CREATE TABLE public.admin_users(id uuid PRIMARY KEY); GRANT SELECT ON public.admin_users TO authenticated;
      CREATE TABLE public.contacts(id uuid PRIMARY KEY,user_id uuid,email text,produto text,outreach_status text,status text DEFAULT 'Lead');
      ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY owner_contacts ON public.contacts TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
      GRANT ALL ON public.contacts TO authenticated;
      INSERT INTO public.contacts(id,user_id,email,produto,outreach_status) VALUES('${owner}','${owner}','person@example.invalid','barberias','contactable'),('${other}','${other}','person@example.invalid','barberias','contactable');`);
    for(const file of ['20261016052215_email_campaign_observability.sql','20261017034819_guided_campaign_preparation.sql','20261017160727_brevo_event_receiver.sql']) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
    await db.exec(await readFile('supabase/migrations/20261017160727_brevo_event_receiver.sql','utf8'));
    await db.exec(`INSERT INTO public.email_provider_connections(id,user_id,name) VALUES('${connection}','${owner}','Synthetic A'),('${foreignConnection}','${other}','Synthetic B');
      INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,subject,audience_basis) VALUES
        ('${campaign}','${owner}','Synthetic A','barberias','brevo','sender@example.invalid','Synthetic','individual_review'),('${foreignCampaign}','${other}','Synthetic B','barberias','brevo','sender@example.invalid','Synthetic','individual_review');
      INSERT INTO public.email_campaign_recipients(id,campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES
        ('${recipient}','${campaign}','${owner}','${owner}','person@example.invalid','Synthetic evidence'),('${foreignRecipient}','${foreignCampaign}','${other}','${other}','person@example.invalid','Synthetic evidence');`);
    await t.test('event before association stays pending and never creates a contact',async()=>{
      await ingest(event('delivered'));
      assert.equal((await db.query('SELECT id FROM public.email_campaign_events')).rows.length,0);
      assert.equal((await db.query('SELECT id FROM public.contacts')).rows.length,2);
      assert.equal((await db.query<{processing_state:string}>('SELECT processing_state FROM public.email_provider_event_inbox')).rows[0].processing_state,'pending');
    });
    await t.test('service cannot associate a different owner and correct association reconciles once',async()=>{
      await assert.rejects(service('SELECT public.associate_brevo_message($1,$2,$3,$4)',[connection,other,recipient,'message-one']));
      await service('SELECT public.associate_brevo_message($1,$2,$3,$4)',[connection,owner,recipient,'<message-one>']);
      await service('SELECT public.associate_brevo_message($1,$2,$3,$4)',[connection,owner,recipient,'message-one']);
      await ingest(event('delivered'));
      await ingest(event('delivered'));
      assert.equal((await db.query('SELECT id FROM public.email_campaign_events')).rows.length,1);
      assert.equal((await db.query<{status:string}>(`SELECT status FROM public.email_campaigns WHERE id='${campaign}'`)).rows[0].status,'active');
      assert.equal((await db.query<{status:string}>(`SELECT status FROM public.contacts WHERE id='${owner}'`)).rows[0].status,'Lead');
      assert.equal((await db.query<{provider_message_id:string|null}>(`SELECT provider_message_id FROM public.email_campaign_recipients WHERE id='${foreignRecipient}'`)).rows[0].provider_message_id,null);
    });
    await t.test('same message and address in another account do not attach across owners',async()=>{
      await ingest(event('delivered'),foreignConnection);
      assert.equal((await db.query('SELECT id FROM public.email_campaign_events')).rows.length,1);
      assert.equal((await db.query<{processing_state:string}>(`SELECT processing_state FROM public.email_provider_event_inbox WHERE connection_id='${foreignConnection}'`)).rows[0].processing_state,'pending');
    });
    await t.test('linked message without events preserves campaign content and recipient',async()=>{
      await service('SELECT public.associate_brevo_message($1,$2,$3,$4)',[foreignConnection,other,foreignRecipient,'pending-message']);
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${other}';`);
      await assert.rejects(db.query(`UPDATE public.email_campaigns SET subject='changed' WHERE id='${foreignCampaign}' RETURNING id`), /Campaign has provider history/);
      assert.equal((await db.query(`DELETE FROM public.email_campaign_recipients WHERE id='${foreignRecipient}' RETURNING id`)).rows.length,0);
      await db.exec('RESET ROLE');
    });
    await t.test('unknown types are retained without becoming human replies',async()=>{
      await ingest(event('replied'));
      assert.equal((await db.query<{processing_state:string}>("SELECT processing_state FROM public.email_provider_event_inbox WHERE provider_type='replied'")).rows[0].processing_state,'ignored');
      assert.equal((await db.query("SELECT id FROM public.email_campaign_events WHERE event_type='replied'")).rows.length,0);
    });
    await t.test('unmatched opt-out protects future audience for only the affected owner',async()=>{
      await ingest(event('unsubscribed','unmatched-message'));
      await ingest(normalizeBrevoEvent({event:'hard_bounce',email:'invalid@example.invalid','message-id':'unmatched-bounce',ts_event:1767225600}));
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}';`);
      assert.equal((await db.query<{blocked:boolean}>("SELECT public.campaign_email_is_suppressed('person@example.invalid') AS blocked")).rows[0].blocked,true);
      assert.equal((await db.query<{blocked:boolean}>("SELECT public.campaign_email_is_suppressed('invalid@example.invalid') AS blocked")).rows[0].blocked,true);
      assert.equal((await db.query('SELECT * FROM public.email_provider_connections')).rows.length,1);
      await assert.rejects(db.query('SELECT public.ingest_brevo_events($1,$2::jsonb)',[connection,JSON.stringify([event('opened')])]));
      await assert.rejects(db.query("UPDATE public.email_provider_connections SET last_received_at=now()"));
      await db.exec(`SET request.jwt.claim.sub='${other}';`);
      assert.equal((await db.query<{blocked:boolean}>("SELECT public.campaign_email_is_suppressed('person@example.invalid') AS blocked")).rows[0].blocked,false);
      await db.exec('RESET ROLE');
    });
  }finally{await db.exec('RESET ROLE');await db.close();}
});
