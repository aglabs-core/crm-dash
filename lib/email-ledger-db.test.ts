import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeBrevoEvent } from './brevo-events';

const tenant = '0af00833-c1f7-42f4-9543-a5e0ff6f55fc';
const admin = 'c14f0f92-ac71-47d8-a1b6-52da1d83aba9';
const other = '22222222-2222-4222-8222-222222222222';
const connection = '33333333-3333-4333-8333-333333333333';
const prospect = '44444444-4444-4444-8444-444444444444';
const campaign = '55555555-5555-4555-8555-555555555555';
const recipient = '77777777-7777-4777-8777-777777777777';
const brevoId = '<202610160422.80461624219@smtp-relay.example.invalid>';
const resendId = '9b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a10';

async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); INSERT INTO auth.users VALUES('${tenant}'),('${other}'),('${admin}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
    CREATE TABLE public.admin_users(id uuid PRIMARY KEY); INSERT INTO public.admin_users VALUES('${admin}'); GRANT SELECT ON public.admin_users TO authenticated;
    CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text,company text,email text,
      phone text,status text NOT NULL DEFAULT 'Contato',origin text,produto text,notes text,prospecting_pool boolean NOT NULL DEFAULT false,
      outreach_status text NOT NULL DEFAULT 'unreviewed',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz DEFAULT now());
    ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_contacts ON public.contacts TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
    GRANT ALL ON public.contacts TO authenticated,service_role;
    CREATE TABLE public.activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,contact_id uuid,type text,channel text,content text,created_at timestamptz DEFAULT now());
    GRANT ALL ON public.activities TO service_role;
    CREATE TABLE public.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,title text,status text,due_date date,assigned_to text,created_at timestamptz DEFAULT now());
    CREATE FUNCTION public.clear_pool() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.prospecting_pool AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'Arquivado' THEN NEW.prospecting_pool:=false; END IF; RETURN NEW; END $$;
    CREATE TRIGGER clear_pool BEFORE UPDATE OF status ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.clear_pool();
    CREATE SCHEMA maia_intake_private;
    CREATE TABLE maia_intake_private.events(user_id uuid,channel text,scope text,event_id text,subject text,contact_id uuid,pending_id uuid,
      PRIMARY KEY(user_id,channel,scope,event_id));
    CREATE FUNCTION maia_intake_private.pending_email(text,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"status":"pending"}'::jsonb $$;

    CREATE TABLE maia_intake_private.identities(user_id uuid NOT NULL,channel text NOT NULL,subject text NOT NULL,contact_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,channel,subject));
    INSERT INTO public.contacts(id,user_id,name,email,status,origin,produto,prospecting_pool,outreach_status)
      VALUES('${prospect}','${admin}','Barbearia Sintética','dono@barbearia.example.invalid','Arquivado','prospeccao','barberias',true,'contactable');`);
  for (const file of ['20261016052215_email_campaign_observability.sql', '20261017034819_guided_campaign_preparation.sql',
    '20261017160727_brevo_event_receiver.sql', '20261022120000_unified_email_ledger.sql']) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  // Reapplying must be harmless.
  await db.exec(await readFile('supabase/migrations/20261022120000_unified_email_ledger.sql', 'utf8'));
  await db.exec(`INSERT INTO public.email_provider_connections(id,user_id,name) VALUES('${connection}','${admin}','Brevo');
    INSERT INTO public.email_campaigns(id,user_id,name,product,provider,sender_email,subject,audience_basis,status)
      VALUES('${campaign}','${admin}','Prospecção sintética','barberias','brevo','sender@example.invalid','Personalizado','individual_review','completed');
    INSERT INTO public.email_campaign_recipients(id,campaign_id,user_id,contact_id,email_snapshot,review_note,provider_message_id)
      VALUES('${recipient}','${campaign}','${admin}','${prospect}','dono@barbearia.example.invalid','Revisão sintética','${brevoId}');`);
  const service = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => {
    await db.exec('SET ROLE service_role');
    try { return await db.query<T>(sql, args); } finally { await db.exec('RESET ROLE'); }
  };
  const asUser = async <T = Record<string, unknown>>(user: string, sql: string, args: unknown[] = []) => {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false)`);
    try { return await db.query<T>(sql, args); } finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false)`); }
  };
  return { db, service, asUser };
}

const prospectMessage = {
  provider: 'brevo', provider_message_id: brevoId, category: 'prospeccao', source_key: 'prospeccao.barberias.lote-sintetico',
  product: 'barberias', campaign_id: campaign, recipient_id: recipient, address: 'Dono@Barbearia.example.invalid',
  from_address: 'sender@example.invalid', reply_to: 'suporte@example.invalid', subject: 'Uma pergunta sobre a agenda da Sintética',
  summary: 'Abordagem individual: pergunta como organizam os horários e apresenta o Barberias.',
  body_html: '<p>Olá</p>', sent_at: '2026-10-16T12:00:00Z', contact_id: prospect,
};

test('ledger records prospecting, mirrors Brevo events, binds identity and gives Maia the thread context', async (t) => {
  const { db, service, asUser } = await setup();
  try {
    await t.test('outbound prospect is recorded once with RFC id and identity binding', async () => {
      const first = await service<{ r: { message_id: string; contact_id: string } }>('SELECT public.crm_record_outbound_email($1::jsonb) r', [JSON.stringify(prospectMessage)]);
      const again = await service<{ r: { message_id: string } }>('SELECT public.crm_record_outbound_email($1::jsonb) r', [JSON.stringify(prospectMessage)]);
      assert.equal(first.rows[0].r.message_id, again.rows[0].r.message_id);
      assert.equal(first.rows[0].r.contact_id, prospect);
      const row = (await db.query<{ rfc_message_id: string; provider_message_id: string; status: string }>('SELECT rfc_message_id,provider_message_id,status FROM public.email_messages')).rows;
      assert.equal(row.length, 1);
      assert.equal(row[0].rfc_message_id, brevoId);
      assert.equal(row[0].provider_message_id, brevoId.slice(1, -1));
      assert.equal(row[0].status, 'accepted');
      const bound = await db.query('SELECT contact_id FROM maia_intake_private.identities WHERE subject=$1', ['dono@barbearia.example.invalid']);
      assert.equal(bound.rows.length, 1);
    });

    await t.test('legacy Maia intake reuses the admin-owned prospect and rejects unrelated ownership', async () => {
      const args = ['email', 'dono@barbearia.example.invalid', 'support@example.invalid', 'mail-1'];
      const intake = await service<{ r: { contact_id: string } }>('SELECT public.maia_contact_intake($1,$2,$3,$4) r', args);
      assert.equal(intake.rows[0].r.contact_id, prospect);
      const replay = await service<{ r: { contact_id: string } }>('SELECT public.maia_contact_intake($1,$2,$3,$4) r', args);
      assert.equal(replay.rows[0].r.contact_id, prospect);
      assert.equal((await db.query(`SELECT 1 FROM public.contacts WHERE email='dono@barbearia.example.invalid'`)).rows.length, 1);
      await db.exec(`UPDATE public.contacts SET user_id='${other}' WHERE id='${prospect}'`);
      const refused = await service<{ r: { status: string } }>('SELECT public.maia_contact_intake($1,$2,$3,$4) r', args);
      assert.equal(refused.rows[0].r.status, 'pending');
      await assert.rejects(service('SELECT public.crm_record_outbound_email($1::jsonb)', [JSON.stringify({ ...prospectMessage, provider_message_id: '<unrelated@example.invalid>' })]));
      await db.exec(`UPDATE public.contacts SET user_id='${admin}' WHERE id='${prospect}'`);
    });

    await t.test('webhook inbox events update ledger status forward only and keep campaign metrics', async () => {
      const ingest = (event: string, ts: number) => service('SELECT public.ingest_brevo_events($1,$2::jsonb)', [connection,
        JSON.stringify([normalizeBrevoEvent({ event, email: 'dono@barbearia.example.invalid', 'message-id': brevoId, ts_event: ts })])]);
      await ingest('request', 1760616000);
      await ingest('delivered', 1760616010);
      await ingest('delivered', 1760616010);
      await ingest('opened', 1760616100);
      await ingest('deferred', 1760616200);
      const m = (await db.query<{ status: string; delivered_at: string | null; opened_at: string | null }>('SELECT status,delivered_at,opened_at FROM public.email_messages')).rows[0];
      assert.equal(m.status, 'opened');
      assert.ok(m.delivered_at && m.opened_at);
      assert.equal((await db.query('SELECT 1 FROM public.email_message_events')).rows.length, 4);
      assert.equal((await db.query('SELECT 1 FROM public.email_campaign_events')).rows.length, 4);
    });

    await t.test('anonymized click is attributed only by a unique recent subject', async () => {
      const matched = await service<{ n: number }>('SELECT public.crm_apply_brevo_anonymized_events($1,$2::jsonb) n', [connection, JSON.stringify([
        { subject: prospectMessage.subject, event_type: 'clicked', provider_type: 'click', occurred_at: '2026-10-16T13:00:00Z', event_key: 'a'.repeat(64) },
        { subject: 'Assunto que não existe', event_type: 'opened', provider_type: 'opened', occurred_at: '2026-10-16T13:00:00Z', event_key: 'b'.repeat(64) },
      ])]);
      assert.equal(matched.rows[0].n, 1);
      assert.equal((await db.query<{ status: string }>('SELECT status FROM public.email_messages')).rows[0].status, 'clicked');
    });

    await t.test('Maia context matches the thread by In-Reply-To and never exposes bodies', async () => {
      const ctx = (await service<{ c: Record<string, unknown> }>('SELECT public.maia_email_context($1,$2) c', ['dono@barbearia.example.invalid', [brevoId]])).rows[0].c;
      assert.equal(ctx.status, 'found');
      assert.equal(ctx.match, 'thread');
      assert.equal((ctx.replying_to as { subject: string }).subject, prospectMessage.subject);
      assert.equal(JSON.stringify(ctx).includes('<p>'), false);
      const unknown = (await service<{ c: { status: string } }>('SELECT public.maia_email_context($1,NULL) c', ['nobody@example.invalid'])).rows[0].c;
      assert.equal(unknown.status, 'unknown');
    });

    await t.test('reply marks replied on message and campaign, is idempotent', async () => {
      const args = ['dono@barbearia.example.invalid', [brevoId], '<reply-1@mail.example.invalid>', 'Re: agenda', 'Respondeu que tem interesse em testar.', '2026-10-17T10:00:00Z'];
      const r = (await service<{ r: { status: string; match: string } }>('SELECT public.maia_email_reply_record($1,$2,$3,$4,$5,$6::timestamptz) r', args)).rows[0].r;
      assert.equal(r.status, 'recorded'); assert.equal(r.match, 'thread');
      assert.equal((await service<{ r: { status: string } }>('SELECT public.maia_email_reply_record($1,$2,$3,$4,$5,$6::timestamptz) r', args)).rows[0].r.status, 'duplicate');
      const out = (await db.query<{ status: string; replied_at: string | null }>(`SELECT status,replied_at FROM public.email_messages WHERE direction='outbound'`)).rows[0];
      assert.equal(out.status, 'replied'); assert.ok(out.replied_at);
      assert.equal((await db.query(`SELECT 1 FROM public.email_campaign_events WHERE event_type='replied'`)).rows.length, 1);
      await assert.rejects(service('SELECT public.maia_email_reply_record($1,$2,$3,$4,$5,$6::timestamptz)',
        ['dono@barbearia.example.invalid', [], '<reply-2@mail.example.invalid>', 'Re', 'Meu cartão 4111 1111 1111 1111', '2026-10-17T10:00:00Z']));
    });

    await t.test('hard bounce blocks outreach', async () => {
      await service('SELECT public.crm_apply_email_event($1,$2,$3,$4,$5,$6::timestamptz)', ['brevo', brevoId, 'bounced', 'hard_bounce', 'hb-1', '2026-10-18T10:00:00Z']);
      assert.equal((await db.query<{ outreach_status: string }>(`SELECT outreach_status FROM public.contacts WHERE id='${prospect}'`)).rows[0].outreach_status, 'blocked');
    });

    await t.test('Resend trial e-mail creates a Lead with account status; unknown customer e-mail is ignored', async () => {
      const record = { category: 'automacao', source_key: 'barberias.trial.inicio', product: 'barberias', subject: 'Bem-vindo ao Barberias — Nova',
        summary: 'Boas-vindas ao teste grátis.', sent_at: '2026-10-19T14:00:00Z', rfc_message_id: '<abc@resend.example.invalid>',
        contact: { name: 'Nova', company: 'Nova', status: 'Lead', origin: 'cadastro', product: 'barberias', account_status: 'trial', promote_status: 'Lead' } };
      const sent = { email_id: resendId, address: 'novo@dono.example.invalid', event_type: 'accepted', provider_event_type: 'email.sent', event_key: 'msg_1', occurred_at: '2026-10-19T14:00:00Z', record };
      await service('SELECT public.crm_ingest_resend_event($1::jsonb)', [JSON.stringify(sent)]);
      await service('SELECT public.crm_ingest_resend_event($1::jsonb)', [JSON.stringify({ ...sent, event_type: 'delivered', provider_event_type: 'email.delivered', event_key: 'msg_2', occurred_at: '2026-10-19T14:00:05Z' })]);
      const c = (await db.query<{ status: string; account_status: string; origin: string }>(`SELECT status,account_status,origin FROM public.contacts WHERE email='novo@dono.example.invalid'`)).rows;
      assert.deepEqual(c, [{ status: 'Lead', account_status: 'trial', origin: 'cadastro' }]);
      assert.equal((await db.query<{ status: string }>(`SELECT status FROM public.email_messages WHERE provider='resend'`)).rows[0].status, 'delivered');
      const ignored = await service<{ r: { status: string } }>('SELECT public.crm_ingest_resend_event($1::jsonb) r', [JSON.stringify({ email_id: '1b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a11', address: 'cliente@final.example.invalid', event_type: 'accepted', event_key: 'msg_3', occurred_at: '2026-10-19T14:00:00Z' })]);
      assert.equal(ignored.rows[0].r.status, 'ignored');
      assert.equal((await db.query(`SELECT 1 FROM public.contacts WHERE email='cliente@final.example.invalid'`)).rows.length, 0);
      // A later stage advances the account; a late earlier-stage e-mail never regresses it.
      await service('SELECT public.crm_ingest_resend_event($1::jsonb)', [JSON.stringify({ ...sent, email_id: '2b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a12', event_key: 'msg_4',
        record: { ...record, source_key: 'barberias.trial.encerrado', rfc_message_id: '<def@resend.example.invalid>', contact: { ...record.contact, account_status: 'trial_encerrado' } } })]);
      await service('SELECT public.crm_ingest_resend_event($1::jsonb)', [JSON.stringify({ ...sent, email_id: '3b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a13', event_key: 'msg_5',
        record: { ...record, source_key: 'barberias.trial.meio', rfc_message_id: '<ghi@resend.example.invalid>' } })]);
      assert.equal((await db.query<{ account_status: string }>(`SELECT account_status FROM public.contacts WHERE email='novo@dono.example.invalid'`)).rows[0].account_status, 'trial_encerrado');
    });

    await t.test('account events promote prospects, set lifecycle and deduplicate', async () => {
      const ev = { event_key: 'acc-1', event: 'account.created', occurred_at: '2026-10-20T10:00:00Z', product: 'barberias', account_ref: 'shop-1',
        account_name: 'Barbearia Sintética', owner_email: 'dono@barbearia.example.invalid' };
      await service('SELECT public.crm_ingest_account_event($1::jsonb)', [JSON.stringify(ev)]);
      assert.equal((await service<{ r: { status: string } }>('SELECT public.crm_ingest_account_event($1::jsonb) r', [JSON.stringify(ev)])).rows[0].r.status, 'duplicate');
      let c = (await db.query<{ status: string; account_status: string; prospecting_pool: boolean }>(`SELECT status,account_status,prospecting_pool FROM public.contacts WHERE id='${prospect}'`)).rows[0];
      assert.deepEqual(c, { status: 'Lead', account_status: 'trial', prospecting_pool: false });
      await service('SELECT public.crm_ingest_account_event($1::jsonb)', [JSON.stringify({ ...ev, event_key: 'acc-2', event: 'subscription.active' })]);
      c = (await db.query<{ status: string; account_status: string; prospecting_pool: boolean }>(`SELECT status,account_status,prospecting_pool FROM public.contacts WHERE id='${prospect}'`)).rows[0];
      assert.equal(c.status, 'Cliente'); assert.equal(c.account_status, 'ativo');
      // A late trial e-mail never regresses an active account.
      await service('SELECT public.crm_ingest_resend_event($1::jsonb)', [JSON.stringify({ email_id: '4b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a14', address: 'dono@barbearia.example.invalid',
        event_type: 'accepted', event_key: 'msg_6', occurred_at: '2026-10-20T11:00:00Z', record: { category: 'automacao', source_key: 'barberias.trial.encerrado',
          subject: 'Seu teste terminou', sent_at: '2026-10-20T11:00:00Z', contact: { account_status: 'trial_encerrado' } } })]);
      assert.equal((await db.query<{ account_status: string }>(`SELECT account_status FROM public.contacts WHERE id='${prospect}'`)).rows[0].account_status, 'ativo');
      assert.ok((await db.query(`SELECT 1 FROM public.activities WHERE channel='sistema'`)).rows.length >= 2);
    });

    await t.test('browser reads own ledger only and cannot write or call service RPCs', async () => {
      assert.ok((await asUser(tenant, 'SELECT id FROM public.email_messages')).rows.length >= 3);
      assert.equal((await asUser(other, 'SELECT id FROM public.email_messages')).rows.length, 0);
      assert.ok((await asUser(tenant, 'SELECT * FROM public.email_source_summary')).rows.length >= 2);
      assert.equal((await asUser(other, 'SELECT * FROM public.email_source_summary')).rows.length, 0);
      await assert.rejects(asUser(tenant, `UPDATE public.email_messages SET status='replied'`));
      await assert.rejects(asUser(tenant, 'SELECT public.crm_record_outbound_email($1::jsonb)', [JSON.stringify(prospectMessage)]));
      await assert.rejects(asUser(tenant, 'SELECT public.maia_email_context($1,NULL)', ['dono@barbearia.example.invalid']));
    });
  } finally {
    await db.close();
  }
});
