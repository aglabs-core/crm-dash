import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeFeedbackEvent, receiveFeedbackEvent } from './product-feedback';

const event = {
  event: 'feedback.submitted', event_key: 'fb-1', occurred_at: '2026-10-29T12:00:00Z', product: 'Members',
  account_ref: 'user-1', owner_email: 'Pessoa@Example.invalid', message: '  O Pix demorou para liberar o curso.  ', pathname: '/checkout/curso?cupom=X',
};

test('feedback: normaliza produto, e-mail, chave e guarda só o caminho da tela', () => {
  const n = normalizeFeedbackEvent(event, Date.parse('2026-10-29T12:01:00Z'));
  assert.equal(n.event_key, 'members:feedback:fb-1');
  assert.equal(n.owner_email, 'pessoa@example.invalid');
  assert.equal(n.message, 'O Pix demorou para liberar o curso.');
  assert.equal(n.pathname, '/checkout/curso');
  assert.equal(normalizeFeedbackEvent({ ...event, owner_email: undefined, pathname: 'https://fora' }).pathname, null);
  for (const bad of [{ event: 'account.created' }, { message: 'x' }, { message: 'y'.repeat(2001) }, { product: 'Mem bers' }, { owner_email: 'sem-arroba' }, { occurred_at: '2099-01-01T00:00:00Z' }])
    assert.throws(() => normalizeFeedbackEvent({ ...event, ...bad }));
});

test('feedback: receptor exige token e repassa o evento normalizado', async () => {
  const token = 't'.repeat(40);
  const received: unknown[] = [];
  const deps = { config: { token, url: 'https://synthetic.example.invalid', serviceKey: 'synthetic' }, ingest: async (e: unknown) => { received.push(e); } };
  const req = (auth: string, body: unknown = event) => new Request('https://crm.example.invalid/api/integrations/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) });
  assert.equal((await receiveFeedbackEvent(req('Bearer wrong'), deps)).status, 401);
  assert.equal((await receiveFeedbackEvent(req(`Bearer ${token}`, { ...event, message: '' }), deps)).status, 400);
  assert.equal((await receiveFeedbackEvent(req(`Bearer ${token}`), deps)).status, 200);
  assert.equal(received.length, 1);
  assert.equal((await receiveFeedbackEvent(req(`Bearer ${token}`), { ...deps, ingest: async () => { throw new Error('db'); } })).status, 503);
  assert.equal((await receiveFeedbackEvent(req(`Bearer ${token}`), { ...deps, config: { ...deps.config, token: 'curto' } })).status, 503);
});

test('feedback no banco: liga ao contato sem criar lead, deduplica, registra nota e só o service role escreve', async () => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111', contact = '22222222-2222-4222-8222-222222222222';
  const service = async (sql: string, args: unknown[] = []) => { await db.exec('SET ROLE service_role'); try { return await db.query(sql, args); } finally { await db.exec('RESET ROLE'); } };
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE SCHEMA crm_ledger_private; CREATE FUNCTION crm_ledger_private.tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${owner}'::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
      CREATE TABLE public.contacts(id uuid PRIMARY KEY, user_id uuid, email text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.activities(id serial PRIMARY KEY, user_id uuid, contact_id uuid, type text, channel text, content text);
      INSERT INTO public.contacts(id, user_id, email) VALUES ('${contact}', '${owner}', 'Pessoa@Example.invalid');`);
    await db.exec(await readFile('supabase/migrations/20261030010000_product_feedback.sql', 'utf8'));
    const ingest = (over: Record<string, unknown> = {}) => service('SELECT public.crm_ingest_product_feedback($1::jsonb) AS r', [JSON.stringify({ ...normalizeFeedbackEvent(event), ...over })]);

    const first = (await ingest()).rows[0] as { r: { status: string; contact_linked: boolean; feedback_id: string } };
    assert.equal(first.r.status, 'recorded');
    assert.equal(first.r.contact_linked, true);
    assert.equal(((await ingest()).rows[0] as { r: { status: string } }).r.status, 'duplicate');
    const stranger = (await ingest({ event_key: 'members:feedback:fb-2', owner_email: 'outra@example.invalid' })).rows[0] as { r: { contact_linked: boolean } };
    assert.equal(stranger.r.contact_linked, false);
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.contacts')).rows[0].n, 1, 'feedback não cria contato');
    const notes = (await db.query<{ type: string; channel: string; content: string }>('SELECT type, channel, content FROM public.activities')).rows;
    assert.equal(notes.length, 1);
    assert.match(notes[0].content, /^Members: feedback enviado pelo app \(\/checkout\/curso\) — O Pix/);
    assert.deepEqual([notes[0].type, notes[0].channel], ['suporte', 'sistema']);

    await assert.rejects(ingest({ event_key: 'members:feedback:fb-3', message: 'x' }), /invalid feedback event/);
    await service("SELECT public.crm_set_product_feedback_status($1, 'resolvido', 'orbita')", [first.r.feedback_id]);
    const row = (await db.query<{ status: string; reviewed_by: string }>('SELECT status, reviewed_by FROM public.product_feedback WHERE id = $1', [first.r.feedback_id])).rows[0];
    assert.deepEqual([row.status, row.reviewed_by], ['resolvido', 'orbita']);
    await assert.rejects(service("SELECT public.crm_set_product_feedback_status($1, 'lido', 'orbita')", [contact]), /feedback not found/);

    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query("SELECT public.crm_ingest_product_feedback('{}'::jsonb)"), /permission denied/);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});
