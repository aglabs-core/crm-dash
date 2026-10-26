import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productMetrics } from './product-metrics';

test('additional sources preserve the existing write-only source and reject ambiguous overrides before fetching', async () => {
  const original=process.env.APP_METRICS_SOURCES, previousExtra=process.env.APP_METRICS_SOURCES_EXTRA, fetcher=globalThis.fetch;
  const base=JSON.stringify([{product:'barberias',url:'https://barberias.com.br/api/integrations/orbita/metrics',token:'existing-fixture-'.repeat(3)}]);
  const member={product:'members',url:'https://members.ia.br/api/integrations/crm/metrics',token:'members-fixture-'.repeat(3)};
  const calls:string[]=[];
  try {
    process.env.APP_METRICS_SOURCES=base;process.env.APP_METRICS_SOURCES_EXTRA=JSON.stringify([member]);
    globalThis.fetch=async url=>{
      calls.push(String(url));const product=String(url).includes('barberias')?'barberias':'members';
      const at=new Date().toISOString();
      return Response.json({version:1,product,generatedAt:at,window:{from:at,to:at},metrics:{users:3,accounts:null,activeAccounts:null,trialAccounts:null,payingAccounts:null,complimentaryAccounts:null,canceledAccounts:null,activatedAccounts:null}});
    };
    assert.equal((await productMetrics('barberias')).status,'ok');
    assert.equal((await productMetrics('members')).status,'ok');
    assert.equal(process.env.APP_METRICS_SOURCES,base);
    assert.equal(calls.length,2);
    process.env.APP_METRICS_SOURCES_EXTRA=JSON.stringify([member,{...member,token:'other-fixture-'.repeat(3)}]);
    assert.equal((await productMetrics('members')).status,'unavailable');assert.equal(calls.length,2);
    assert.equal((await productMetrics('barberias')).status,'ok');
    process.env.APP_METRICS_SOURCES_EXTRA=JSON.stringify([{...member,url:'https://example.invalid/metrics'}]);
    const before=calls.length;assert.equal((await productMetrics('members')).status,'unavailable');assert.equal(calls.length,before);
    process.env.APP_METRICS_SOURCES_EXTRA='{}';assert.equal((await productMetrics('members')).status,'unavailable');
  } finally {
    globalThis.fetch=fetcher;
    if(original===undefined)delete process.env.APP_METRICS_SOURCES;else process.env.APP_METRICS_SOURCES=original;
    if(previousExtra===undefined)delete process.env.APP_METRICS_SOURCES_EXTRA;else process.env.APP_METRICS_SOURCES_EXTRA=previousExtra;
  }
});
