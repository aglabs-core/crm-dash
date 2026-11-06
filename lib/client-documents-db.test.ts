import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('private documents isolate owners, preserve originals, and require matching evidence and payment', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const contact = '33333333-3333-4333-8333-333333333333';
  const foreign = '44444444-4444-4444-8444-444444444444';
  const doc = '55555555-5555-4555-8555-555555555555';
  const payment = '66666666-6666-4666-8666-666666666666';
  const path = `${owner}/${contact}/${doc}.pdf`;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${owner}'),('${other}');
      CREATE TABLE contacts(id uuid PRIMARY KEY,user_id uuid NOT NULL);
      CREATE TABLE payment_transactions(id uuid PRIMARY KEY,user_id uuid NOT NULL,contact_id uuid);
      INSERT INTO contacts VALUES('${contact}','${owner}'),('${foreign}','${other}');
      INSERT INTO payment_transactions VALUES('${payment}','${owner}','${contact}');
      ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own ON contacts TO authenticated USING(user_id=auth.uid());
      CREATE POLICY own ON payment_transactions TO authenticated USING(user_id=auth.uid());
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon;
      GRANT SELECT ON contacts,payment_transactions TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`);
    const migration = await readFile('supabase/migrations/20261106160752_private_client_documents.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    assert.equal((await db.query<{public: boolean}>("SELECT public FROM storage.buckets WHERE id='crm-documents'")).rows[0].public, false);
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${owner}'`);
    const insert = (contactId = contact, paymentId: string | null = payment, size = 12) => db.exec(`INSERT INTO client_documents(id,user_id,contact_id,payment_id,title,category,file_name,extension,mime_type,size_bytes,sha256)
      VALUES('${doc}','${owner}','${contactId}',${paymentId ? `'${paymentId}'` : 'null'},'Sintético','invoice_pdf','synthetic.pdf','pdf','application/pdf',${size},'${'a'.repeat(64)}')`);
    await assert.rejects(insert(), /Original unavailable/);
    await assert.rejects(db.exec(`INSERT INTO storage.objects(bucket_id,name) VALUES('crm-documents','${owner}/${foreign}/${doc}.pdf')`), /row-level security/);
    await db.exec(`INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('crm-documents','${path}','{"mimetype":"application/pdf","size":12}')`);
    await assert.rejects(insert(contact, payment, 99), /Original unavailable/);
    await insert();
    assert.equal((await db.query('SELECT * FROM client_documents')).rows.length,1);
    await assert.rejects(db.exec('UPDATE client_documents SET title=\'Changed\''), /permission denied/);
    await db.exec("DELETE FROM storage.objects WHERE bucket_id='crm-documents'");
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,1);
    await db.exec(`RESET ROLE; UPDATE payment_transactions SET contact_id='${foreign}' WHERE id='${payment}'; SET ROLE authenticated`);
    await assert.rejects(insert(), /Payment does not belong/);
    await db.exec(`SET request.jwt.claim.sub='${other}'`);
    assert.equal((await db.query('SELECT * FROM client_documents')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length,0);
    await assert.rejects(insert(), /Original unavailable|row-level security/);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM client_documents'), /permission denied/);
  } finally { await db.close(); }
});
