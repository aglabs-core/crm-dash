import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { ManagementReport } from './management-report';

test('management aggregates retain RLS, money/date semantics and contain no personal records', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,produto text,status text,prospecting_pool boolean,amount numeric,
        created_at timestamptz DEFAULT now(),closed_at timestamptz,email text,phone text,whatsapp text,instagram text);
      CREATE TABLE payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid,product text,status text,currency text,
        amount numeric,refunded_amount numeric,net_amount numeric,paid_at timestamptz);
      CREATE TABLE tasks(id uuid DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid,status text,assigned_to text);
      ALTER TABLE contacts ENABLE ROW LEVEL SECURITY; ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY; ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own ON contacts TO authenticated USING(user_id=auth.uid());
      CREATE POLICY own ON payment_transactions TO authenticated USING(user_id=auth.uid());
      CREATE POLICY own ON tasks TO authenticated USING(user_id=auth.uid());
      GRANT SELECT ON contacts,payment_transactions,tasks TO authenticated;
      INSERT INTO contacts(user_id,produto,status,prospecting_pool,amount,email,phone,whatsapp) VALUES
        ('11111111-1111-4111-8111-111111111111','barberias','Lead',false,200,'private@example.invalid','(11) 99999-0000',NULL),
        ('11111111-1111-4111-8111-111111111111','barberias','Proposta',false,300,'other@example.invalid',NULL,'11999990000'),
        ('11111111-1111-4111-8111-111111111111',NULL,'Contato',false,0,NULL,NULL,NULL),
        ('22222222-2222-4222-8222-222222222222','foreign-owner','Cliente',false,99999,'secret@example.invalid',NULL,NULL);
      INSERT INTO payment_transactions(user_id,product,status,currency,amount,refunded_amount,net_amount,paid_at) VALUES
        ('11111111-1111-4111-8111-111111111111','barberias','paid','BRL',100,0,100,'2026-11-01T01:30:00Z'),
        ('11111111-1111-4111-8111-111111111111','barberias','chargeback','BRL',90,0,90,now()),
        ('11111111-1111-4111-8111-111111111111','barberias','paid','USD',999,0,999,now()),
        ('22222222-2222-4222-8222-222222222222','foreign-owner','paid','BRL',99999,0,99999,now());`);
    const journeyMigration=await readFile('supabase/migrations/20261112113000_structured_journey.sql','utf8');
    await db.exec(journeyMigration); await db.exec(journeyMigration);
    const migration=await readFile('supabase/migrations/20261112120000_management_reports.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'`);
    const report=(await db.query<{report:ManagementReport}>('SELECT crm_management_report() report')).rows[0].report;
    assert.equal(report.metrics.revenue,100); assert.equal(report.metrics.pipeline,500);
    assert.equal(report.contactsCount,2); assert.equal(report.quality!.totalContacts,3);
    assert.equal(report.quality!.sharedIdentityGroups,1); assert.equal(report.quality!.missingChannel,1);
    assert.equal(report.metrics.series.find(s=>s.key==='2026-10')?.revenue,100);
    assert.equal(report.metrics.series.find(s=>s.key==='2026-11')?.revenue,0);
    for(const text of ['private@example.invalid','secret@example.invalid','foreign-owner','11999990000']) assert.ok(!JSON.stringify(report).includes(text));
    await assert.rejects(db.query('SELECT crm_management_report(NULL,7,12)'),/Invalid report window/);
    await assert.rejects(db.query(`INSERT INTO contact_stage_events(contact_id,user_id,next_status) SELECT id,user_id,'Cliente' FROM contacts LIMIT 1`),/permission denied/);
    await db.exec(`RESET ROLE;
      UPDATE crm_journey_coverage SET started_at=now()-interval '3 days';
      INSERT INTO contacts(id,user_id,produto,status,prospecting_pool) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','barberias','Lead',false),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','barberias','Lead',false),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','22222222-2222-4222-8222-222222222222','barberias','Lead',false),
        ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','barberias','Cliente',false);
      UPDATE contacts SET status='Cliente' WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      UPDATE contacts SET status='Arquivado' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      UPDATE contact_stage_events SET changed_at=CASE WHEN previous_status IS NULL THEN now()-interval '2 days' ELSE now()-interval '1 day' END;
      SET ROLE authenticated; SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';`);
    const journey=(await db.query<{journey:NonNullable<ManagementReport['journey']>}>('SELECT crm_journey_report() journey')).rows[0].journey;
    assert.equal(journey.leads,2);assert.equal(journey.converted,1);assert.equal(journey.conversionRate,50);assert.equal(journey.averageDaysToCustomer,1);
    assert.equal(journey.completedStageTimes.find(s=>s.stage==='Lead')?.completedintervals,2);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('SELECT crm_management_report()'),/permission denied/);
    await db.exec('RESET ROLE; SET ROLE authenticated; RESET request.jwt.claim.sub');
    assert.equal((await db.query<{report:ManagementReport}>('SELECT crm_management_report() report')).rows[0].report.contactsCount,0);
  } finally { await db.close(); }
});
