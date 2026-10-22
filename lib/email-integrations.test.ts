import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { classifySystemEmail } from './system-email-classifier';
import { normalizeResendEvent, receiveResendWebhook, verifySvixSignature, type ResendReceiverConfig } from './resend-webhook';
import { normalizeAccountEvent, receiveAccountEvent } from './account-events';
import { normalizeBrevoAnonymizedEvent } from './brevo-events';
import { receiveBrevoWebhook } from './brevo-receiver';

const FROM = 'Barberias <suporte@barberias.com.br>';

test('classifier keeps owner-facing Barberias e-mails and drops customer or staff e-mails', () => {
  const cases: [string, string | null][] = [
    ['Bem-vindo ao Barberias — Barbearia do Zé', 'barberias.trial.inicio'],
    ['Seu teste do Barberias começou, Barberias', 'barberias.trial.inicio'],
    ['Aproveite seu teste: restam cerca de 4 dias', 'barberias.trial.meio'],
    ['Faltam 4 dias do seu teste no Barberias', 'barberias.trial.meio'],
    ['Seu período de teste está terminando', 'barberias.trial.ultimo-dia'],
    ['Seu teste terminou — veja como continuar', 'barberias.trial.encerrado'],
    ['Um desconto para a Barbearia do Zé voltar ao Barberias', 'barberias.trial.recuperacao'],
    ['A Barbearia do Zé continua salva no Barberias', 'barberias.trial.recuperacao'],
    ['Último lembrete: cupom VOLTA20 para a Barbearia do Zé', 'barberias.trial.ultima-chance'],
    ['Último lembrete sobre o teste da Barbearia do Zé', 'barberias.trial.ultima-chance'],
    ['Convite para administrar — Barbearia do Zé', 'barberias.conta.convite-admin'],
    ['Agendamento confirmado — BARBEARIA X', null],
    ['✅ Agendamento confirmado - BARBEARIA X', null],
    ['Redefina sua senha — Barbearia X', null],
    ['Convite para a equipe — Barbearia X', null],
    ['Nova solicitação de cadastro — Barbearia X', null],
  ];
  for (const [subject, key] of cases) assert.equal(classifySystemEmail({ from: FROM, subject })?.source_key ?? null, key, subject);
  assert.equal(classifySystemEmail({ from: FROM, subject: 'Bem-vindo ao Barberias — Barbearia do Zé' })?.account_name, 'Barbearia do Zé');
  assert.equal(classifySystemEmail({ from: FROM, subject: 'Seu teste terminou — veja como continuar' })?.account_status, 'trial_encerrado');
  assert.equal(classifySystemEmail({ from: 'Outro <a@outro.example.invalid>', subject: 'Seu período de teste está terminando' }), null);
  // Tags win over subjects and exclude untagged categories.
  assert.equal(classifySystemEmail({ from: FROM, subject: 'Qualquer', tags: [{ name: 'category', value: 'trial' }, { name: 'stage', value: 'recuperacao' }] })?.source_key, 'barberias.trial.recuperacao');
  assert.equal(classifySystemEmail({ from: FROM, subject: 'Bem-vindo ao Barberias — X', tags: { category: 'appointment' } }), null);
});

const secret = `whsec_${Buffer.from('synthetic-secret-with-enough-bytes').toString('base64')}`;
const config: ResendReceiverConfig = { secret, url: 'https://synthetic.example.invalid', serviceKey: 'synthetic' };
const now = Date.parse('2026-10-22T12:00:00Z');
const sentPayload = { type: 'email.sent', created_at: '2026-10-22T11:59:00.000Z', data: {
  email_id: '9b0d6a52-6f1e-4d3a-9a51-0e8d2f6f1a10', created_at: '2026-10-22T11:58:59.000Z', from: FROM,
  to: ['Dono@Barbearia.example.invalid'], subject: 'Bem-vindo ao Barberias — Nova' } };
function signed(body: string, id = 'msg_synthetic_1', ts = Math.floor(now / 1000)) {
  const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return new Request('https://crm.example.invalid/api/integrations/resend/webhook', { method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` }, body });
}

test('Svix signature is required, exact and time-bounded', () => {
  const body = JSON.stringify(sentPayload);
  assert.equal(verifySvixSignature(secret, signed(body).headers, body, now), true);
  assert.equal(verifySvixSignature(secret, signed(body).headers, body + ' ', now), false);
  assert.equal(verifySvixSignature(secret, signed(body, 'msg_1', Math.floor(now / 1000) - 600).headers, body, now), false);
});

test('Resend events normalize to ledger events; customer e-mails carry no record', () => {
  const event = normalizeResendEvent(sentPayload, 'msg_1', now)!;
  assert.equal(event.address, 'dono@barbearia.example.invalid');
  assert.equal(event.event_type, 'accepted');
  assert.equal((event.record as { source_key: string }).source_key, 'barberias.trial.inicio');
  const bounce = normalizeResendEvent({ ...sentPayload, type: 'email.bounced', data: { ...sentPayload.data, bounce: { type: 'Permanent' } } }, 'msg_2', now)!;
  assert.equal(bounce.event_type, 'bounced');
  const customer = normalizeResendEvent({ ...sentPayload, data: { ...sentPayload.data, subject: 'Agendamento confirmado — X' } }, 'msg_3', now)!;
  assert.equal(customer.record, undefined);
  assert.equal(normalizeResendEvent({ type: 'domain.updated', created_at: sentPayload.created_at, data: {} }, 'msg_4', now), null);
});

test('Resend receiver rejects bad signatures and persists before acknowledging', async () => {
  const body = JSON.stringify(sentPayload);
  let stored: unknown = null;
  const deps = { config, now, ingest: async (event: unknown) => { stored = event; }, messageId: async () => '<abc@resend.example.invalid>' };
  const forged = signed(body); forged.headers.set('svix-signature', 'v1,AAAA');
  assert.equal((await receiveResendWebhook(forged, deps)).status, 401);
  assert.equal(stored, null);
  assert.equal((await receiveResendWebhook(signed(body), { ...deps, config: { ...config, secret: '' } })).status, 503);
  const ok = await receiveResendWebhook(signed(body), deps);
  assert.equal(ok.status, 200);
  assert.equal(((stored as unknown as { record: { rfc_message_id: string } }).record).rfc_message_id, '<abc@resend.example.invalid>');
  const failed = await receiveResendWebhook(signed(body), { ...deps, ingest: async () => { throw new Error('synthetic'); } });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('barbearia.example'), false);
});

test('account events require a token and a well-formed lifecycle event', async () => {
  const token = 't'.repeat(40);
  const event = { event: 'account.created', event_key: 'shop-1:created', occurred_at: '2026-10-01T10:00:00Z', product: 'barberias',
    account_ref: 'shop-1', account_name: 'Nova', owner_email: 'Dono@Nova.example.invalid' };
  assert.equal(normalizeAccountEvent(event).event_key, 'barberias:shop-1:created');
  assert.equal(normalizeAccountEvent(event).owner_email, 'dono@nova.example.invalid');
  assert.throws(() => normalizeAccountEvent({ ...event, event: 'invented' }));
  const req = (auth: string) => new Request('https://crm.example.invalid/api/integrations/accounts/events', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(event) });
  let calls = 0;
  const deps = { config: { token, url: 'https://synthetic.example.invalid', serviceKey: 'synthetic' }, ingest: async () => { calls++; } };
  assert.equal((await receiveAccountEvent(req('Bearer wrong'), deps)).status, 401);
  assert.equal((await receiveAccountEvent(req(`Bearer ${token}`), deps)).status, 200);
  assert.equal(calls, 1);
});

test('anonymized Brevo opens are accepted instead of failing the batch', async () => {
  const anonymous = { event: 'opened', email: '', 'message-id': 'an#123', subject: 'Uma pergunta sobre a agenda', ts_event: 1767225600 };
  assert.equal(normalizeBrevoAnonymizedEvent(anonymous)?.event_type, 'opened');
  assert.equal(normalizeBrevoAnonymizedEvent({ ...anonymous, event: 'delivered' }), null);
  assert.equal(normalizeBrevoAnonymizedEvent({ ...anonymous, email: 'a@b.example.invalid' }), null);
  const brevoConfig = { token: 'x'.repeat(40), connectionId: '11111111-1111-4111-8111-111111111111', url: 'https://synthetic.example.invalid', serviceKey: 'synthetic' };
  let regular = 0, anonymized = 0;
  const res = await receiveBrevoWebhook(new Request('https://crm.example.invalid/api/integrations/brevo/webhook', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${brevoConfig.token}` }, body: JSON.stringify([anonymous]) }),
  { config: brevoConfig, ingest: async (e) => { regular += e.length; }, ingestAnonymized: async (e) => { anonymized += e.length; } });
  assert.equal(res.status, 200);
  assert.equal(regular, 0); assert.equal(anonymized, 1);
});
