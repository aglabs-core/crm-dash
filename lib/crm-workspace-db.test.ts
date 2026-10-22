import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('workspace views paginate, normalize phone and keep aggregates isolated by RLS', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, phone text, whatsapp text,
        produto text, origin text, status text, prospecting_pool boolean, outreach_status text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE email_messages(user_id uuid, product text, category text, sent_at timestamptz);
      CREATE TABLE email_campaigns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, product text, created_at timestamptz);
      CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,due_date date,status text);
      CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,created_at timestamptz,type text,channel text);
      ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
      ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own ON contacts TO authenticated USING(user_id=auth.uid());
      CREATE POLICY own ON email_messages TO authenticated USING(user_id=auth.uid());
      CREATE POLICY own ON email_campaigns TO authenticated USING(user_id=auth.uid());
      GRANT SELECT ON contacts,email_messages,email_campaigns TO authenticated;
      INSERT INTO contacts(user_id,name,phone,whatsapp,produto,origin,status,prospecting_pool,outreach_status)
        SELECT '11111111-1111-4111-8111-111111111111','Sintético',null,'+55 (11) 99999-0000','barberias','prospeccao','Arquivado',true,'contactable' FROM generate_series(1,65);
      INSERT INTO contacts(user_id,name,produto,status) VALUES('22222222-2222-4222-8222-222222222222','Outro','mecard','Cliente');
      INSERT INTO email_messages VALUES('11111111-1111-4111-8111-111111111111','barberias','automacao',now()),('22222222-2222-4222-8222-222222222222','mecard','prospeccao',now());
      INSERT INTO email_campaigns(user_id,product) VALUES('11111111-1111-4111-8111-111111111111','aglabs');`);
    const migration = await readFile('supabase/migrations/20261022195737_crm_workspace_indexes.sql', 'utf8');
    await db.exec(migration); await db.exec(migration);
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'`);
    const total = await db.query<{ total: number }>('SELECT sum(total)::int AS total FROM contact_workspace_summary');
    assert.equal(total.rows[0].total, 65);
    const page = await db.query<{ whatsapp_digits: string }>('SELECT whatsapp_digits FROM contact_directory ORDER BY created_at DESC,id OFFSET 50 LIMIT 50');
    assert.equal(page.rows.length, 15); assert.equal(page.rows[0].whatsapp_digits, '5511999990000');
    const products = await db.query<{ product: string }>('SELECT product FROM email_workspace_products ORDER BY product');
    assert.deepEqual(products.rows.map((r) => r.product), ['aglabs', 'barberias']);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM contact_directory'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE authenticated; RESET request.jwt.claim.sub');
    assert.equal((await db.query('SELECT * FROM contact_workspace_summary')).rows.length, 0);
  } finally { await db.close(); }
});
