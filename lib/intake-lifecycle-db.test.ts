import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';

test('intake stays neutral, explicit qualification advances, and refund replay never reactivates a customer', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,email text,phone text,whatsapp text,company text,priority text,status text,origin text,produto text,plano text,amount numeric,documento text,gateway text,external_id text,instagram text,instagram_id text,instagram_oferta_em timestamptz,prospecting_pool boolean default false,updated_at timestamptz default now());
      CREATE TABLE public.activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid,type text,channel text,content text);
      CREATE TABLE public.payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid,gateway text,external_id text,status text,product text,currency text,amount numeric,refunded_amount numeric,net_amount numeric GENERATED ALWAYS AS (greatest(amount-refunded_amount,0)) STORED,paid_at timestamptz,UNIQUE(user_id,gateway,external_id));
      CREATE SCHEMA maia_intake_private;
      CREATE TABLE maia_intake_private.identities(user_id uuid,channel text,subject text,contact_id uuid);
      CREATE TABLE maia_intake_private.events(user_id uuid,channel text,scope text,event_id text,subject text,contact_id uuid,pending_id uuid);
      CREATE TABLE public.maia_identity_pending(user_id uuid,channel text,subject text,claimed_email text,candidate_contact_id uuid,source_contact_id uuid,status text,UNIQUE(user_id,channel,subject,claimed_email));
      CREATE SCHEMA automation_private;
      CREATE TABLE automation_private.instagram_events(channel text,event_id text,instagram_id text,contact_id uuid,PRIMARY KEY(channel,event_id));
      CREATE TABLE automation_private.instagram_offer_dispatches(instagram_id text,contact_id uuid);
    `);
    const migration = await readFile('supabase/migrations/20261017203721_correct_intake_qualification_and_refund_lifecycle.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    await db.query("select public.maia_whatsapp_intake($1)", ['5511999990001']);
    assert.equal((await db.query<{status:string}>("select status from contacts where whatsapp=$1", ['5511999990001'])).rows[0].status,'Contato');
    const record = (body: Record<string,unknown>) => db.query('select public.maia_whatsapp_contact(null,$1::jsonb)', [JSON.stringify(body)]);
    await record({whatsapp:'5511999990001',status:'Atendimento',produto:'Synthetic'});
    assert.equal((await db.query<{status:string}>("select status from contacts where whatsapp=$1", ['5511999990001'])).rows[0].status,'Contato');
    await record({whatsapp:'5511999990001',status:'Lead',commercial_intent:true,qualification_reason:'Solicitou proposta comercial para o projeto.'});
    assert.equal((await db.query<{status:string}>("select status from contacts where whatsapp=$1", ['5511999990001'])).rows[0].status,'Lead');
    await db.query("select public.maia_contact_intake('email',$1,'synthetic','one')", ['inbound@example.invalid']);
    assert.equal((await db.query<{status:string}>("select status from contacts where email=$1", ['inbound@example.invalid'])).rows[0].status,'Contato');
    await db.query("select * from public.registrar_lead_instagram('123456789','synthetic','PROMPT','Synthetic','comentario','event-one')");
    await db.query("select * from public.registrar_lead_instagram('123456789','synthetic','PROMPT','Synthetic','comentario','event-one')");
    assert.equal((await db.query<{status:string}>("select status from contacts where instagram_id='123456789'")).rows[0].status,'Contato');
    assert.equal((await db.query<{count:number}>('select count(*)::int as count from automation_private.instagram_events')).rows[0].count,1);
    const pay = (id:string,status:string,refunded:number) => db.query("select public.ingest_payment_transaction($1,'asaas',$2,$3,17,$4,'BRL','Synthetic',null,null,'buyer@example.invalid',null,null)",[owner,id,status,refunded]);
    await pay('synthetic-one','paid',0); await pay('synthetic-one','refunded',17);
    const buyer = async()=> (await db.query<{status:string;amount:string}>("select status,amount from contacts where email='buyer@example.invalid'")).rows[0];
    assert.equal((await buyer()).status,'Inativo'); assert.equal(Number((await buyer()).amount),0);
    await pay('synthetic-one','paid',0);
    assert.equal((await buyer()).status,'Inativo');
    await pay('synthetic-two','paid',0);
    assert.equal((await buyer()).status,'Cliente');
    await pay('synthetic-two','partially_refunded',5);
    assert.equal(Number((await buyer()).amount),12);
    await record({whatsapp:'5511999990001',status:'Atendimento',commercial_intent:true,qualification_reason:'Solicitou atendimento para contratar o serviço.'});
    await db.exec("update contacts set status='Inativo' where whatsapp='5511999990001'");
    await record({whatsapp:'5511999990001',status:'Lead',commercial_intent:true,qualification_reason:'Solicitou uma nova proposta comercial.'});
    assert.equal((await db.query<{status:string}>("select status from contacts where whatsapp='5511999990001'")).rows[0].status,'Inativo');
  } finally { await db.close(); }
});
