import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Brevo backfill resolves the entire manifest in owner scope before any write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crm-backfill-test-'));
  try {
    const manifest = join(dir, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ lots: [{ campaign: { name: 'Synthetic', product: 'barberias', sender_email: 'sender@example.invalid', subject: 'Synthetic', source_key: 'prospeccao.synthetic' }, messages: [{ email: 'one@example.invalid', message_id: '<one@example.invalid>', subject: 'Synthetic', sent_at: '2026-10-01T00:00:00Z', summary: 'Synthetic', review_note: 'Synthetic review' }, { contact_id: 'foreign', email: 'two@example.invalid', message_id: '<two@example.invalid>', subject: 'Synthetic', sent_at: '2026-10-01T00:00:00Z', summary: 'Synthetic', review_note: 'Synthetic review' }] }] }));
    const wrapper = join(dir, 'probe.mjs');
    await writeFile(wrapper, `
      process.argv = ['node','backfill','brevo',${JSON.stringify(manifest)},'--apply'];
      process.env.SUPABASE_URL='https://synthetic.example.invalid';
      process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic'; process.env.BREVO_CONNECTION_ID='connection';
      let writes=0;
      process.on('exit',()=>console.log('WRITES='+writes));
      globalThis.fetch=async(input,init={})=>{
        const url=new URL(String(input));
        if(init.method==='POST'){writes++; return Response.json(url.pathname.includes('/rpc/')?{}:[{id:'created'}]);}
        if(url.pathname.endsWith('/email_provider_connections')) return Response.json([{user_id:'owner'}]);
        if(url.pathname.endsWith('/email_campaigns')) return Response.json([{id:'campaign',user_id:'owner',product:'barberias',provider:'brevo'}]);
        if(url.pathname.endsWith('/contacts')) return Response.json(url.searchParams.get('id')==='eq.foreign'?[{id:'foreign',user_id:'foreign-owner',email:'two@example.invalid'}]:[{id:'one',user_id:'owner',email:'one@example.invalid'}]);
        if(url.pathname.endsWith('/email_campaign_recipients')) return Response.json([]);
        return Response.json({events:[]});
      };
      await import(${JSON.stringify(join(process.cwd(), 'scripts/backfill-email-ledger.ts'))});
    `);
    const result = spawnSync(process.execPath, ['--import', 'tsx', wrapper], { encoding: 'utf8', timeout: 20000 });
    assert.match(result.stdout, /WRITES=0/, result.stdout + result.stderr);
    assert.equal(result.status, 1, 'foreign contact must be rejected before writes');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
