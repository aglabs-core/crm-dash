import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadManagementReport } from './management-report';

test('only an absent RPC enables compatibility; no personal or external reference fields are requested', async () => {
  const requests:URL[]=[];
  const client=createClient('https://synthetic.invalid','synthetic',{global:{fetch:async input=>{
    const url=new URL(String(input));requests.push(url);
    if(url.pathname.includes('/rpc/')) return new Response(JSON.stringify({code:'PGRST202',message:'function absent'}),{status:404,headers:{'content-type':'application/json'}});
    const offset=Number(url.searchParams.get('offset') || 0);
    const contacts=url.pathname.endsWith('/contacts');
    return new Response(JSON.stringify(offset===0 && contacts ? [{id:'synthetic',produto:'barberias',status:'Lead',prospecting_pool:false,amount:100,created_at:new Date().toISOString()}] : []),{headers:{'content-type':'application/json'}});
  }}});
  const report=await loadManagementReport(null,null,new AbortController().signal,client);
  assert.equal(report.aggregation,'compatibility');assert.equal(report.contactsCount,1);assert.equal(report.quality,null);
  assert.equal(report.metrics.pipeline,100);
  for(const url of requests.filter(u=>!u.pathname.includes('/rpc/'))) {
    assert.doesNotMatch(url.searchParams.get('select') || '',/\*|email|phone|name|document|external_id/);
  }
});
test('permission failures remain explicit and do not download the base',async()=>{
  let requests=0;
  const client=createClient('https://synthetic.invalid','synthetic',{global:{fetch:async()=>{
    requests++;return new Response(JSON.stringify({code:'42501',message:'permission denied'}),{status:403,headers:{'content-type':'application/json'}});
  }}});
  await assert.rejects(loadManagementReport(null,null,new AbortController().signal,client),/indisponível/);
  assert.equal(requests,1);
});
