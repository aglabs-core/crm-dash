import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from './format';
test('SQL DATE keeps its calendar day in Sao Paulo, UTC and Tokyo', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['America/Sao_Paulo', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      assert.equal(formatDate('2026-10-16'), '16/10/2026', timezone);
    }
    process.env.TZ = 'America/Sao_Paulo';
    assert.equal(formatDate('2026-10-16T00:00:00Z'), '15/10/2026');
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});
