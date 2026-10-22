import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEmailContent } from './email-content';

const id = '11111111-1111-4111-8111-111111111111';
const providerId = '22222222-2222-4222-8222-222222222222';
const config = { url: 'https://synthetic.example.invalid', anonKey: 'synthetic', resendKey: 'synthetic-server-key' };
const message = { provider: 'resend', direction: 'outbound', provider_message_id: providerId,
  address: 'owner@example.invalid', subject: 'Teste sintético', body_html: null, body_text: null };
const req = (token = 'synthetic-jwt') => new Request(`https://synthetic.example.invalid/api/emails/${id}/content`, { headers: { Authorization: `Bearer ${token}` } });
const provider = { id: providerId, to: [message.address], subject: message.subject, html: '<p>Teste</p>', text: 'Teste' };

test('email content checks authorization before provider access and uses no public cache', async () => {
  let lookups = 0;
  const dependencies = { config, read: async () => null, retrieve: async () => { lookups++; return provider; } };
  assert.equal((await getEmailContent(new Request('https://example.invalid'), id, dependencies)).status, 401);
  const denied = await getEmailContent(req(), id, dependencies);
  assert.equal(denied.status, 404); assert.equal(lookups, 0);
  assert.match(denied.headers.get('cache-control')!, /no-store/);
  assert.equal(denied.headers.get('vary'), 'Authorization');
});

test('authorized Resend preview verifies id, exact subject and sole recipient', async () => {
  const deps = { config, read: async () => message, retrieve: async () => provider };
  const response = await getEmailContent(req(), id, deps);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).body_html, '<p>Teste</p>');
  for (const bad of [{ ...provider, to: ['other@example.invalid'] }, { ...provider, id },
    { ...provider, subject: 'Outro' }, { ...provider, to: [message.address, 'cc@example.invalid'] }]) {
    const result = await getEmailContent(req(), id, { ...deps, retrieve: async () => bad });
    assert.equal(result.status, 404); assert.equal((await result.text()).includes('Teste'), false);
  }
});

test('stored content and missing configuration need no provider call; provider failures expose no payload', async () => {
  const retrieve = async () => { throw new Error('Secret content and address'); };
  const stored = await getEmailContent(req(), id, { config, read: async () => ({ ...message, body_html: '<p>Saved</p>' }), retrieve });
  assert.equal((await stored.json()).source, 'stored');
  const noKey = await getEmailContent(req(), id, { config: { ...config, resendKey: undefined }, read: async () => message, retrieve });
  assert.equal((await noKey.json()).reason, 'not_stored');
  const failed = await getEmailContent(req(), id, { config, read: async () => message, retrieve });
  assert.equal(failed.status, 503); assert.equal((await failed.text()).includes('Secret'), false);
});
