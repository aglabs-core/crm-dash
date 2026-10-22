import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadContactPage, loadContactRollups, type ContactFilters } from './contact-directory';

const filters: ContactFilters = { product: 'barberias', origin: 'cadastro', situation: 'pipeline', outreach: 'Todos', search: '' };
const signal = () => new AbortController().signal;
function fixture(rows: unknown[] = [], total = 123) {
  const urls: URL[] = [];
  const client = createClient('https://synthetic.example.invalid', 'synthetic', { auth: { persistSession: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); urls.push(url);
      const body = url.pathname.endsWith('contact_workspace_summary') && urls.length > 1 ? [] : rows;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'content-range': `0-49/${total}` } });
    } } });
  return { client, urls };
}
test('contact page filters at the server, asks for only 50 and keeps global count', async () => {
  const { client, urls } = fixture([{ id: 'synthetic' }]);
  const result = await loadContactPage(filters, 2, signal(), client);
  assert.equal(result.count, 123); assert.equal(result.contacts.length, 1);
  const p = urls[0].searchParams;
  assert.equal(p.get('offset'), '100'); assert.equal(p.get('limit'), '50');
  assert.equal(p.get('product_key'), 'eq.barberias'); assert.equal(p.get('origin'), 'eq.cadastro');
  assert.equal(p.get('prospecting_pool'), 'eq.false'); assert.match(p.get('status')!, /Lead,Contatado,Atendimento,Proposta,Pagamento/);
});
test('quoted search cannot add filter operators and also searches normalized phone', async () => {
  const { client, urls } = fixture();
  await loadContactPage({ ...filters, search: '"),status.eq.Cliente,(5511', situation: 'prospeccao', outreach: 'blocked' }, 0, signal(), client);
  const p = urls[0].searchParams;
  assert.equal(p.get('prospecting_pool'), 'eq.true'); assert.equal(p.get('outreach_status'), 'eq.blocked');
  assert.match(p.get('or')!, /name\.ilike\."%\\"\),status.eq.Cliente,\(5511%"/);
  assert.match(p.get('or')!, /whatsapp_digits.like.%5511%/);
});
test('rollups read beyond a short server page without fetching personal records', async () => {
  const { client, urls } = fixture([{ produto: 'barberias', total: 100 }]);
  const result = await loadContactRollups(signal(), client);
  assert.equal(result.length, 1); assert.equal(urls.length, 2);
  assert.equal(urls[1].searchParams.get('offset'), '1');
  assert.equal(urls[0].pathname, '/rest/v1/contact_workspace_summary');
});
