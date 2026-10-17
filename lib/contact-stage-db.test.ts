import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('neutral stage migration is repeatable and preserves sales and prospecting records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.contacts (id text primary key, status text default 'Lead', prospecting_pool boolean default false);
      insert into contacts values ('sale', 'Cliente', false), ('lead', 'Lead', false), ('cold', 'Arquivado', true), ('unknown', 'legacy-invalid', false);`);
    const migration = await readFile(new URL('../supabase/migrations/20261017202237_add_unqualified_contact_stage.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("insert into contacts (id) values ('inbound')");
    const { rows } = await db.query<{id: string; status: string; prospecting_pool: boolean}>('select * from contacts order by id');
    assert.deepEqual(rows, [
      { id: 'cold', status: 'Arquivado', prospecting_pool: true },
      { id: 'inbound', status: 'Contato', prospecting_pool: false },
      { id: 'lead', status: 'Lead', prospecting_pool: false },
      { id: 'sale', status: 'Cliente', prospecting_pool: false },
      { id: 'unknown', status: 'Contato', prospecting_pool: false },
    ]);
    await assert.rejects(db.exec("insert into contacts (id,status) values ('bad','invalid')"));
  } finally { await db.close(); }
});
