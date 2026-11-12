import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readAllPages } from './pagination';
import { loadContacts } from './contact-data';
import { supabaseCrmStore } from './mcp-store';

test('contact and MCP readers survive smaller server caps and keep all 700 records', async () => {
  const offsets: number[] = [];
  const fetchPage: typeof fetch = async input => {
    const url = new URL(String(input)); const offset = Number(url.searchParams.get('offset') || 0); offsets.push(offset);
    return new Response(JSON.stringify(Array.from({ length: Math.max(0, Math.min(200, 700-offset)) }, (_,i)=>({ id: String(offset+i), status: 'Lead' }))), { headers: { 'content-type': 'application/json' } });
  };
  const client = createClient('https://synthetic.invalid', 'synthetic', { global: { fetch: fetchPage } });
  assert.equal((await loadContacts('created_at', true, {}, client)).length, 700);
  assert.deepEqual(offsets.splice(0), [0,200,400,600,700]);
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    globalThis.fetch=fetchPage; process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
    assert.equal((await supabaseCrmStore()!.funnelContacts()).length,700);
    assert.deepEqual(offsets, [0,200,400,600,700]);
  } finally {
    globalThis.fetch=previousFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;
  }
});
test('failure after a partial page never returns an incomplete total', async () => {
  await assert.rejects(readAllPages(async from => from===0 ? {data:[1],error:null} : {data:null,error:{message:'synthetic failure'}}), /synthetic failure/);
});
