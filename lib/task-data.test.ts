import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadTasks } from './task-data';

function fixture(fail = false) {
  const offsets: number[] = [];
  const client = createClient('https://synthetic.example.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get('offset') || 0);
      offsets.push(offset);
      if (fail && offset > 0) return new Response(JSON.stringify({ message: 'synthetic' }), { status: 400 });
      const rows = Array.from({ length: 7 }, (_, i) => ({ id: String(i), title: 'Synthetic', status: 'pending' })).slice(offset, offset + 3);
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { client, offsets };
}
test('tasks paginate across short server pages without losing totals', async () => {
  const { client, offsets } = fixture();
  assert.equal((await loadTasks(client)).length, 7);
  assert.deepEqual(offsets, [0, 3, 6, 7]);
});
test('a failed task page rejects the partial total', async () => {
  const { client } = fixture(true);
  await assert.rejects(loadTasks(client));
});
