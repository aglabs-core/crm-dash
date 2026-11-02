// One-shot entry point for the existing external job/cron mechanism.
// No dotenv, production schedule, provider key or service-role session is loaded.
import { runSecondBatch, httpProvider } from '../lib/campaign-executor.mjs';
const enabled=process.env.CRM_CAMPAIGN_SECOND_ENABLED==='true';
const reconcile=process.argv.includes('--reconcile');
if(!enabled&&!reconcile){console.log(JSON.stringify({status:'disabled'}));}
else {
  const url=new URL(process.env.CRM_CAMPAIGN_RPC_URL);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Explicit RPC endpoint required');
  const token=process.env.CRM_CAMPAIGN_OWNER_TOKEN;
  const apiKey=process.env.CRM_CAMPAIGN_ANON_KEY;
  if(!token||!apiKey)throw Error('Authenticated owner session and public API key required');
  const parameters={
    list_campaign_second_work:['p_mode','p_limit'],claim_campaign_second_dispatch:['p_item'],
    start_campaign_dispatch:['p_id','p_token'],finish_campaign_dispatch:['p_id','p_token','p_provider_id'],
    publish_campaign_second_dispatch:['p_id'],
  };
  const rpc=async(name,args)=>{
    const keys=parameters[name];if(!keys||args.length!==keys.length)throw Error('Unsupported RPC');
    const response=await fetch(new URL(name,url.href.endsWith('/')?url:new URL(url.href+'/')),{
      method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,apikey:apiKey,'content-type':'application/json'},
      body:JSON.stringify(Object.fromEntries(keys.map((key,index)=>[key,args[index]]))),signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw Error(`RPC ${name} requires review (${response.status})`);
    return response.json();
  };
  let provider;
  if(!reconcile){
    const providerUrl=new URL(process.env.CRM_CAMPAIGN_TEST_PROVIDER_URL);
    // This vertical deliberately ships no production provider binding.
    if(providerUrl.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(providerUrl.hostname))throw Error('Only explicit loopback test provider installed');
    provider=httpProvider({url:providerUrl.href,timeoutMs:1000});
  }
  const result=await runSecondBatch({enabled,reconcile,rpc,provider,limit:Number(process.env.CRM_CAMPAIGN_BATCH_LIMIT)});
  console.log(JSON.stringify(result));
}
