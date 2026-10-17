import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTask, latestInteraction, daysSince, byContact } from './pipeline-context';
import type { Activity, Task } from './types';

test('next task prioritizes overdue, ignores completed and puts undated last', () => {
  const tasks: Task[] = [
    { id: 'done', title: 'Concluída', status: 'completed', due_date: '2020-01-01' },
    { id: 'undated', title: 'Sem prazo', status: 'pending' },
    { id: 'future', title: 'Futura', status: 'pending', due_date: '2027-01-01' },
    { id: 'overdue', title: 'Pendente', status: 'pending', due_date: '2026-01-01', assigned_to: 'maia' },
  ];
  assert.equal(nextTask(tasks)?.id, 'overdue');
  assert.equal(tasks[0].id, 'done');
  assert.equal(nextTask([]), undefined);
});

test('sends and system changes never become latest conversation', () => {
  const activities = [
    { id: 'conversation', type: 'suporte', channel: 'whatsapp', created_at: '2026-01-01' },
    { id: 'send', type: 'disparo', channel: 'email', created_at: '2026-02-01' },
    { id: 'welcome', type: 'boas_vindas', channel: 'email', created_at: '2026-02-02' },
    { id: 'stage', type: 'stage_change', channel: 'sistema', created_at: '2026-03-01' },
    { id: 'invalid', type: 'meeting', channel: 'telefone', created_at: 'invalid' },
  ] as Activity[];
  assert.equal(latestInteraction(activities)?.id, 'conversation');
  assert.equal(latestInteraction(activities.slice(1)), undefined);
  assert.equal(daysSince('2026-01-01', Date.parse('2026-01-03')), 2);
  assert.equal(daysSince('2027-01-01', Date.parse('2026-01-03')), 0);
});

test('context never mixes contacts or unlinked records', () => {
  const grouped = byContact([{ contact_id: 'a', id: 1 }, { contact_id: 'b', id: 2 }, { contact_id: null, id: 3 }]);
  assert.deepEqual(grouped.get('a')?.map((r) => r.id), [1]);
  assert.equal(grouped.size, 2);
});
