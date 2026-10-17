import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadPipelineContext } from './pipeline-data';

function fixture(total: number, cap: number, failure = false, failOn = 1) {
  const urls: URL[] = [];
  const client = createClient('https://synthetic.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); urls.push(url);
      if (failure && urls.length === failOn) return new Response(JSON.stringify({ message: 'synthetic failure' }), { status: 400 });
      const cursor = url.searchParams.get('id')?.replace('gt.', '') || '';
      const rows = Array.from({ length: total }, (_, i) => ({ id: String(i + 1).padStart(6, '0'),
        tasks: [{ id: `task-${i}`, title: 'Synthetic task', status: 'pending', due_date: '2026-10-16' }],
        activities: [{ id: `activity-${i}`, type: 'meeting', channel: 'telefone', created_at: '2026-10-15T12:00:00Z' }],
      })).filter((r) => r.id > cursor).slice(0, cap);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, urls };
}

test('1000 contacts need three summary requests with one task and interaction per parent', async () => {
  const { client, urls } = fixture(1000, 500);
  const summary = await loadPipelineContext(new AbortController().signal, client);
  assert.equal(urls.length, 3);
  assert.equal(summary.tasks.length, 1000);
  assert.equal(summary.activities.length, 1000);
  assert.equal(summary.tasks[999].contact_id, '001000');
  const params = urls[0].searchParams;
  assert.equal(params.get('tasks.limit'), '1');
  assert.equal(params.get('activities.limit'), '1');
  assert.equal(params.get('tasks.status'), 'eq.pending');
  assert.equal(params.get('activities.type'), 'in.(followup,suporte,meeting)');
  assert.equal(params.get('activities.channel'), 'neq.sistema');
  assert.equal(params.get('tasks.order'), 'due_date.asc.nullslast,id.asc');
  assert.equal(params.get('activities.order'), 'created_at.desc,id.asc');
});

test('smaller server caps and short pages do not silently truncate contacts', async () => {
  const { client, urls } = fixture(7, 3);
  const summary = await loadPipelineContext(new AbortController().signal, client);
  assert.equal(summary.tasks.length, 7);
  assert.equal(urls.length, 4);
});

test('failed summary rejects rather than claiming contacts have no tasks', async () => {
  const { client } = fixture(7, 3, true);
  await assert.rejects(loadPipelineContext(new AbortController().signal, client));
});

test('canceled summary makes no requests', async () => {
  const { client, urls } = fixture(7, 3);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadPipelineContext(controller.signal, client));
  assert.equal(urls.length, 0);
});

test('a later page failure rejects the partial summary', async () => {
  const { client, urls } = fixture(7, 3, true, 2);
  await assert.rejects(loadPipelineContext(new AbortController().signal, client));
  assert.equal(urls.length, 2);
});
