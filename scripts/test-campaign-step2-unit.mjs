import assert from 'node:assert/strict';
import { executeOne } from '../lib/campaign-executor.mjs';
let names=[];
const rpc=async(name)=>{names.push(name);return {status:'disabled'};};
const provider={preflight(){},send(){throw Error('No send permitted');}};
assert.deepEqual(await executeOne({enabled:true,step:'second',rpc,provider,itemId:'synthetic'}),{status:'disabled'});
assert.deepEqual(names,['claim_campaign_second_dispatch']);
console.log('PASS second step never routes through initial admission');
const executorModule = await import('../lib/campaign-executor.mjs');
const runBatch = executorModule.runSecondBatch ?? executeOne; // executable baseline before orchestration
names=[];
const batchRpc=async(name,args)=>{
  names.push(name);
  if(name==='list_campaign_second_work')return [{item_id:'synthetic'}];
  if(name==='claim_campaign_second_dispatch' || name==='claim_campaign_dispatch')return {status:'review'};
  throw Error(`Unexpected ${name} ${args}`);
};
assert.deepEqual(await runBatch({enabled:true,rpc:batchRpc,provider,limit:1}),{status:'complete',results:[{status:'review'}]});
assert.deepEqual(names,['list_campaign_second_work','claim_campaign_second_dispatch']);
console.log('PASS bounded runner discovers and executes only second work');
names=[];
await assert.rejects(executeOne({enabled:true,step:'step2',rpc,provider,itemId:'synthetic'}),/Unsupported campaign step/);
assert.deepEqual(names,[]);
console.log('PASS unsupported step cannot fall back to initial');
assert.deepEqual(await runBatch({rpc(){throw Error('must not access RPC');}}),{status:'disabled'});
console.log('PASS disabled runner performs zero RPC/provider work');
