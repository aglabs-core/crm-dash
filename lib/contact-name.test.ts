import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as names from './contact-name';
import type { Contact, Task } from './types';

it('accepts database null names in contacts and joined task contacts', () => {
  const contact: Contact = { id: 'synthetic-contact', name: null, status: 'Lead' };
  const task: Task = { id: 'synthetic-task', title: 'Synthetic', status: 'pending', contacts: contact };
  assert.equal(names.contactName(task.contacts?.name), 'Sem nome');
});

it('round-trips an unknown name through editing as null, never a display label', () => {
  const input = names.contactNameInput(null);
  assert.equal(input, '');
  assert.equal(names.contactNamePayload(input), null);
  assert.equal(names.contactNamePayload('   '), null);
  assert.equal(names.contactNameInput('Ana Silva'), 'Ana Silva');
  assert.equal(names.contactNamePayload(' Ana Silva '), 'Ana Silva');
});

it('searches nameless contacts safely while preserving name and company matches', () => {
  assert.equal(names.contactMatchesSearch({ name: null }, 'ana'), false);
  assert.equal(names.contactMatchesSearch({ name: null }, ''), true);
  assert.equal(names.contactMatchesSearch({ name: null, company: 'Example' }, 'EXAMPLE'), true);
  assert.equal(names.contactMatchesSearch({ name: 'Ana Silva' }, 'ANA'), true);
});

it('renders a safe avatar for unknown or whitespace-only names', () => {
  assert.equal(names.contactInitials(null), '?');
  assert.equal(names.contactInitials('   '), '?');
  assert.equal(names.contactInitials(' Ana  Silva '), 'AS');
});

it('displays a neutral label for an unknown name without inventing identity', () => {
  assert.equal(names.contactName(null), 'Sem nome');
  assert.equal(names.contactName('   '), 'Sem nome');
  assert.equal(names.contactName('Ana Silva'), 'Ana Silva');
});
