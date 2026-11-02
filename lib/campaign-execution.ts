import { createClient } from '@supabase/supabase-js';
import { brevoProvider, validBinding, uuid } from './campaign-brevo';
import { runSecondBatch } from './campaign-executor.mjs';

type Dependencies={env?:Record<string,string|undefined>;transport?:typeof fetch};
const reply=(code:number,status:string,extra:object={})=>Response.json({status,...extra},{status:code,headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});
/** Server-only entry. No request-supplied grants, destinations, keys, URL or limit. */
export async function handleCampaignExecution(request:Request,mode:'send'|'reconcile',dependencies:Dependencies={}) {
  const env=dependencies.env??process.env;
  if(mode==='send' && env.CRM_CAMPAIGN_SECOND_ENABLED!=='true') return reply(200,'disabled');
  const token=/^Bearer (\S{1,8192})$/.exec(request.headers.get('authorization')??'')?.[1];
  if(!token) return reply(401,'unauthorized');
  // Requests are trigger-only; even a small body is not a configuration source.
  if(request.method!=='POST'||request.body!==null||new URL(request.url).search) return reply(400,'invalid_request');
  try {
    const binding:unknown=JSON.parse(env.CRM_CAMPAIGN_BREVO_BINDING??'null');
    const limit=Number(env.CRM_CAMPAIGN_BATCH_LIMIT);
    const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL??'');
    if(!validBinding(binding)||!Number.isInteger(limit)||limit<1||limit>5||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return reply(503,'configuration_unavailable');
    const transport=dependencies.transport??fetch;
    const provider=mode==='send'?brevoProvider({binding,apiKey:env.BREVO_API_KEY??'',transport}):undefined;
    provider?.preflight(); // Local validation precedes even authentication I/O.
    const client=createClient(url.href,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>transport(input,{...init,redirect:'error',signal:AbortSignal.timeout(5000)})}});
    const {data:auth,error:authError}=await client.auth.getUser(token);
    if(authError||!auth.user) return reply(401,'unauthorized');
    if(auth.user.id!==binding.ownerId) return reply(403,'forbidden');
    // Existing owner-scoped connection, not a body-supplied account assertion.
    const {data:connection,error:connectionError}=await client.from('email_provider_connections').select('id,user_id,provider').eq('id',binding.connectionId).eq('user_id',binding.ownerId).maybeSingle();
    if(connectionError||!connection||connection.id!==binding.connectionId||connection.user_id!==binding.ownerId||connection.provider!=='brevo') return reply(503,'binding_unavailable');
    const parameters:Record<string,string[]>={list_campaign_second_work:['p_mode','p_limit'],claim_campaign_second_dispatch:['p_item'],start_campaign_dispatch:['p_id','p_token'],finish_campaign_dispatch:['p_id','p_token','p_provider_id'],publish_campaign_second_dispatch:['p_id']};
    const rpc=async(name:string,args:unknown[])=>{
      const keys=parameters[name]; if(!keys||keys.length!==args.length) throw Error('Unsupported RPC');
      if(name==='claim_campaign_second_dispatch') {
        if(!provider||!uuid(args[0])) throw Error('Invalid immutable work binding');
        const {data:item,error:itemError}=await client.from('email_campaign_batch_recipients').select('second_message').eq('id',args[0]).eq('user_id',binding.ownerId).maybeSingle();
        if(itemError||!item) throw Error('Immutable message unavailable');
        provider.validateMessage(item.second_message);
      }
      // The existing start RPC transaction revalidates pause, opt-out, response,
      // payment/trial, delivery clock and immutable recipient binding after claim.
      const {data,error}=await client.rpc(name,Object.fromEntries(keys.map((key,index)=>[key,args[index]])));
      if(error) throw Error('RPC unavailable');
      return data;
    };
    const result=await runSecondBatch({enabled:mode==='send',reconcile:mode==='reconcile',rpc,provider,limit});
    // Never return provider ID, subject/body, address, grants, tokens or raw RPC errors.
    const allowed=new Set(['accepted','uncertain','published','pending','review','disabled','busy','fenced','duplicate','dispatch_started','not_accepted']);
    const outcomes=(result.results??[]).map((row:{status?:unknown;ledger?:unknown})=>({
      status:typeof row?.status==='string'&&allowed.has(row.status)?row.status:'review',
      ...(row?.ledger==='published'||row?.ledger==='pending'?{ledger:row.ledger}:{}),
    }));
    return reply(200,result.status,{processed:outcomes.length,outcomes});
  } catch {return reply(503,'review_required');}
}
