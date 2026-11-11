import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const lead = '11111111-1111-4111-8111-111111111111';
const client = '22222222-2222-4222-8222-222222222222';
const cold = '33333333-3333-4333-8333-333333333333';
const old = '44444444-4444-4444-8444-444444444444';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA crm_ledger_private;
    CREATE TABLE public.contacts(id uuid PRIMARY KEY, status text NOT NULL, prospecting_pool boolean);
    CREATE TABLE public.email_messages(id serial PRIMARY KEY, contact_id uuid NOT NULL, direction text NOT NULL,
      source_key text NOT NULL, status text NOT NULL DEFAULT 'accepted');
    INSERT INTO public.contacts VALUES ('${lead}','Lead',false),('${client}','Cliente',false),('${cold}','Lead',true),('${old}','Lead',false);
    INSERT INTO public.email_messages(contact_id,direction,source_key,status) VALUES ('${old}','outbound','barberias.trial.recuperacao','delivered');`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261111120000_trial_followup_marks_contacted.sql', import.meta.url), 'utf8'));
  const status = async (id: string) => (await db.query<{ status: string }>('SELECT status FROM public.contacts WHERE id=$1', [id])).rows[0].status;
  return { db, status };
}

test('trial follow-up e-mails move a Lead to Contatado, including earlier sends', async () => {
  const { db, status } = await setup();
  assert.equal(await status(old), 'Contatado');
  await db.exec(`INSERT INTO public.email_messages(contact_id,direction,source_key) VALUES ('${lead}','outbound','barberias.trial.inicio')`);
  assert.equal(await status(lead), 'Lead');
  await db.exec(`INSERT INTO public.email_messages(contact_id,direction,source_key) VALUES ('${lead}','outbound','barberias.trial.encerrado')`);
  assert.equal(await status(lead), 'Contatado');
});

test('it never regresses a customer, touches the cold base or counts a failed send', async () => {
  const { db, status } = await setup();
  await db.exec(`INSERT INTO public.email_messages(contact_id,direction,source_key) VALUES
    ('${client}','outbound','barberias.trial.ultima-chance'),('${cold}','outbound','barberias.trial.recuperacao')`);
  assert.equal(await status(client), 'Cliente');
  assert.equal(await status(cold), 'Lead');
  await db.exec(`INSERT INTO public.email_messages(contact_id,direction,source_key,status) VALUES ('${lead}','outbound','barberias.trial.recuperacao','failed')`);
  assert.equal(await status(lead), 'Lead');
  await db.exec(`UPDATE public.email_messages SET status='delivered' WHERE contact_id='${lead}'`);
  assert.equal(await status(lead), 'Contatado');
});
