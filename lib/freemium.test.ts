import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot,productMetrics} from './product-metrics';
const freemium = {version:1,publishedPages:5,onlinePages:4,publishers:3,trips:null,tripCreators:null,subscriptionAccessUsers:5,paidSubscriptionUsers:2,proMonthly:1,proYearly:1,businessMonthly:0,businessYearly:0,tripPurchases30d:null,tripBuyers30d:null,tripRevenueCents30d:null,currency:'BRL',basis:'current_records_and_confirmed_payments'};
const at = new Date().toISOString();
const snapshot={version:1,product:'mecard',generatedAt:at,window:{from:new Date(Date.parse(at)-30*86400000).toISOString(),to:at},metrics:{users:12,accounts:null,activeAccounts:null,trialAccounts:null,payingAccounts:null,complimentaryAccounts:null,canceledAccounts:null,activatedAccounts:null},freemium};
test('freemium projection removes identities and rejects contradictions and model swaps',()=>{
 const result=validateSnapshot({...snapshot,freemium:{...freemium,email:'private@example.test'}},'mecard');
 assert.equal(result.freemium?.paidSubscriptionUsers,2);assert.doesNotMatch(JSON.stringify(result),/private/);
 for(const change of [{paidSubscriptionUsers:3},{onlinePages:6},{publishers:13},{proMonthly:null},{proYearly:-1},{tripPurchases30d:0}]) assert.throws(()=>validateSnapshot({...snapshot,freemium:{...freemium,...change}},'mecard'));
 assert.throws(()=>validateSnapshot({...snapshot,product:'viajeki'},'viajeki'));
});
test('dedicated product credential preserves opaque source lists and rejects duplicates',async()=>{
 const prior=process.env.APP_METRICS_MECARD_TOKEN,primary=process.env.APP_METRICS_SOURCES,extra=process.env.APP_METRICS_SOURCES_EXTRA,fetcher=globalThis.fetch;
 let calls=0;
 try {
  process.env.APP_METRICS_SOURCES='[]';process.env.APP_METRICS_SOURCES_EXTRA='[]';process.env.APP_METRICS_MECARD_TOKEN='fixture-read-only-'.repeat(3);
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://mecard.com.br/api/integrations/crm/metrics');assert.equal(options?.redirect,'error');return Response.json(snapshot);};
  assert.equal((await productMetrics('mecard')).status,'ok');assert.equal(calls,1);
  process.env.APP_METRICS_SOURCES_EXTRA=JSON.stringify([{product:'mecard',url:'https://mecard.com.br/api/integrations/crm/metrics',token:'other-fixture-'.repeat(3)}]);
  assert.equal((await productMetrics('mecard')).status,'unavailable');assert.equal(calls,1);
 } finally {
  globalThis.fetch=fetcher;
  for(const [key,value] of [['APP_METRICS_MECARD_TOKEN',prior],['APP_METRICS_SOURCES',primary],['APP_METRICS_SOURCES_EXTRA',extra]] as const) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});
