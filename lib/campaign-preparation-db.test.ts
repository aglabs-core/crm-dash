import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const campaign = '33333333-3333-4333-8333-333333333333';
const contact = '44444444-4444-4444-8444-444444444444';
const blocked = '55555555-5555-4555-8555-555555555555';
const foreign = '66666666-6666-4666-8666-666666666666';
const wrongProduct = '77777777-7777-4777-8777-777777777777';
const unreviewed = '88888888-8888-4888-8888-888888888888';

test('guided campaign migration enforces audience isolation, atomicity and replay safety in PostgreSQL', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${owner}'), ('${other}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
      CREATE TABLE public.admin_users(id uuid PRIMARY KEY);
      GRANT SELECT ON public.admin_users TO authenticated;
      CREATE TABLE public.contacts(id uuid PRIMARY KEY, user_id uuid NOT NULL, email text,
        produto text, outreach_status text, status text DEFAULT 'Lead');
      ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_contacts ON public.contacts TO authenticated
        USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
      GRANT SELECT, UPDATE ON public.contacts TO authenticated;
      INSERT INTO public.contacts(id,user_id,email,produto,outreach_status) VALUES
        ('${contact}','${owner}','ok@example.invalid','BarberPRO','contactable'),
        ('${blocked}','${owner}','blocked@example.invalid','barberias','blocked'),
        ('${foreign}','${other}','foreign@example.invalid','barberias','contactable'),
        ('${wrongProduct}','${owner}','wrong@example.invalid','members','contactable'),
        ('${unreviewed}','${owner}','review@example.invalid','barberias','unreviewed');
    `);
    await db.exec(await readFile('supabase/migrations/20261016052215_email_campaign_observability.sql', 'utf8'));
    const migration = await readFile('supabase/migrations/20261017034819_guided_campaign_preparation.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    await db.exec(`INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,subject,audience_basis)
      VALUES ('${campaign}','${owner}','Synthetic','barberias','brevo','sender@example.invalid','Original','individual_review');`);
    const prepare = async (ids: string[], actor = owner) => {
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${actor}';`);
      try {
        return await db.query<{ prepare_email_campaign: number }>(
          'SELECT public.prepare_email_campaign($1, $2, $3, $4, $5::uuid[], $6)',
          [campaign, 'Updated', 'Synthetic content <script>literal</script>', null, ids, 'Synthetic review evidence']);
      } finally { await db.exec('RESET ROLE'); }
    };
    await t.test('rejects wrong owner, blocked, wrong product and unreviewed without partial saves', async () => {
      await assert.rejects(prepare([contact], other));
      for (const id of [blocked, foreign, wrongProduct, unreviewed]) await assert.rejects(prepare([contact, id]));
      assert.equal((await db.query<{ subject: string }>('SELECT subject FROM public.email_campaigns')).rows[0].subject, 'Original');
      assert.equal((await db.query('SELECT id FROM public.email_campaign_recipients')).rows.length, 0);
    });
    await t.test('invalid message, empty evidence and excessive audience cannot partially update a draft', async () => {
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${owner}';`);
      try {
        for (const args of [
          [campaign, '', 'Text', null, [], ''],
          [campaign, 'Updated', 'x'.repeat(12001), null, [], ''],
          [campaign, 'Updated', 'Text', 'invalid', [], ''],
          [campaign, 'Updated', 'Text', null, [contact], 'short'],
          [campaign, 'Updated', 'Text', null, Array(201).fill(contact), 'Synthetic evidence'],
          [campaign, 'Updated', 'Text', null, [null], 'Synthetic evidence'],
        ]) await assert.rejects(db.query('SELECT public.prepare_email_campaign($1,$2,$3,$4,$5::uuid[],$6)', args));
      } finally { await db.exec('RESET ROLE'); }
      assert.equal((await db.query<{ subject: string }>('SELECT subject FROM public.email_campaigns')).rows[0].subject, 'Original');
    });
    await t.test('valid alias is accepted and repeat preparation preserves one membership', async () => {
      assert.equal((await prepare([contact, contact])).rows[0].prepare_email_campaign, 1);
      assert.equal((await prepare([contact])).rows[0].prepare_email_campaign, 0);
      assert.equal((await db.query('SELECT id FROM public.email_campaign_recipients')).rows.length, 1);
      assert.equal((await db.query<{ content_text: string }>('SELECT content_text FROM public.email_campaigns')).rows[0].content_text, 'Synthetic content <script>literal</script>');
      assert.equal((await db.query<{ status: string }>(`SELECT status FROM public.contacts WHERE id = '${contact}'`)).rows[0].status, 'Lead');
    });
    await t.test('direct REST-equivalent insertion cannot bypass audience checks', async () => {
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${owner}';`);
      try {
        for (const [id, email] of [[blocked, 'blocked'], [unreviewed, 'review'], [wrongProduct, 'wrong']]) {
          await assert.rejects(db.query('INSERT INTO public.email_campaign_recipients(campaign_id,user_id,contact_id,email_snapshot,review_note) VALUES ($1,$2,$3,$4,$5)',
            [campaign, owner, id, `${email}@example.invalid`, 'Synthetic evidence']));
        }
      } finally { await db.exec('RESET ROLE'); }
    });
    await t.test('historical opt-out blocks only the affected address and preserves atomicity', async () => {
      await db.exec(`INSERT INTO public.email_campaign_events(recipient_id,event_type,occurred_at) SELECT id,'unsubscribed',now() FROM public.email_campaign_recipients;`);
      // A new draft cannot re-enroll the address; a different reviewed address remains possible.
      const second = '99999999-9999-4999-8999-999999999999';
      await db.exec(`INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,subject,audience_basis)
        VALUES ('${second}','${owner}','Second','barberias','brevo','sender@example.invalid','Second','individual_review');
        UPDATE public.contacts SET outreach_status='contactable' WHERE id='${unreviewed}';`);
      await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${owner}';`);
      try {
        await assert.rejects(db.query('SELECT public.prepare_email_campaign($1,$2,$3,$4,$5::uuid[],$6)', [second,'Updated','Text',null,[contact],'Synthetic evidence']));
        await db.query('SELECT public.prepare_email_campaign($1,$2,$3,$4,$5::uuid[],$6)', [second,'Updated','Text',null,[unreviewed],'Synthetic evidence']);
      } finally { await db.exec('RESET ROLE'); }
      await assert.rejects(prepare([])); // the original campaign has immutable provider history
    });
  } finally { await db.close(); }
});
