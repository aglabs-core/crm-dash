import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActions, type ActionEmail } from './action-center';
import type { Contact, Task } from './types';
const contact = (id: string, extra: Partial<Contact> = {}): Contact => ({ id, name: 'Teste sintético', status: 'Lead', produto: 'barberias', ...extra });
const task = (extra: Partial<Task>): Task => ({ id: 't', title: 'Revisar', status: 'pending', due_date: '2026-10-24', contact_id: 'c', ...extra } as Task);
const email = (extra: Partial<ActionEmail>): ActionEmail => ({ id: 'e', contact_id: 'c', product: 'barberias', direction: 'inbound', category: 'atendimento', status: 'received', sent_at: '2026-10-24T10:00:00Z', created_at: '2026-10-24T10:00:00Z', subject: null, ...extra });
const now = new Date(2026, 9, 25, 12);
test('cold pool, clients and archived contacts never create acquisition next steps', () => {
  const actions = buildActions([contact('cold', { prospecting_pool: true }), contact('client', { status: 'Cliente', account_status: 'trial_encerrado' }), contact('archived', { status: 'Arquivado' }), contact('active')], [], [], now);
  assert.deepEqual(actions.map((a) => a.id), ['next:active']);
});
test('pending tasks prevent a false missing next step; today and completed are not overdue', () => {
  const actions = buildActions([contact('c')], [task({}), task({ id: 'today', due_date: '2026-10-25' }), task({ id: 'done', status: 'completed' })], [], now);
  assert.deepEqual(actions.map((a) => a.id), ['task:t']);
});
test('only explicit ended trial creates a trial review, independently of commercial stage', () => {
  const actions = buildActions([contact('trial', { account_status: 'trial' }), contact('ended', { account_status: 'trial_encerrado' })], [], [], now);
  assert.deepEqual(actions.filter((a) => a.kind === 'trial').map((a) => a.id), ['trial:ended']);
});
test('automatic sends cannot hide a reply, human outbound can, and products stay separate', () => {
  const inbound = email({});
  const automatic = email({ id: 'auto', direction: 'outbound', category: 'transacional', sent_at: '2026-10-25T11:00:00Z' });
  assert.equal(buildActions([contact('c')], [], [inbound, automatic], now).filter((a) => a.kind === 'reply').length, 1);
  const outbound = email({ id: 'human', direction: 'outbound', status: 'sent', sent_at: '2026-10-25T11:00:00Z' });
  assert.equal(buildActions([contact('c')], [], [inbound, outbound], now).filter((a) => a.kind === 'reply').length, 0);
  assert.equal(buildActions([contact('c')], [], [inbound, { ...outbound, product: 'mecard' }], now).filter((a) => a.kind === 'reply').length, 1);
  for (const status of ['scheduled', 'failed', 'bounced']) assert.equal(buildActions([contact('c')], [], [inbound, { ...outbound, status }], now).filter((a) => a.kind === 'reply').length, 1);
});
