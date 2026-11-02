// Local, deterministic packaging only: no database, environment, or provider access.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir='release/crm-dormant';
mkdirSync(`${dir}/ddl`,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const sources=[
 ['20261102200000','20261102212703','dormant_campaign_executor','f6c935041da3c81f0e239073bd19853c72fcbf25'],
 ['20261102210000','20261102212748','campaign_second_step','ff28733619b64cbf6169c9f4d5d124de83ef9954'],
 ['20261102220000','20261102212834','campaign_legacy_second','a69813cdfef22447fd209ae988bad5e2bb5f5f31'],
];
const applied=[
 {version:'20261102203246',name:'guard_email_ledger_bindings_20261102183000'},
 {version:'20261102203544',name:'campaign_followup_review_20261102183500'},
];
const migrations=sources.map(([originalVersion,repositoryVersion,name,reviewedHead],i)=>{
 const migration=`supabase/migrations/${repositoryVersion}_${name}.sql`;
 const payload=`${dir}/ddl/0${i+1}_${name}.sql`;
 const bytes=readFileSync(migration);writeFileSync(payload,bytes);
 return {order:i+1,originalVersion,repositoryVersion,name,reviewedHead,migration,payload,sha256:hash(bytes),dependsOn:i?sources[i-1][1]:applied[1].version,appliedVersion:repositoryVersion,appliedName:name};
});
const manifest={baseMain:'bd99e4423c6a1ad28a982708bca44a7098939949',appliedPrerequisites:applied,migrations,policy:{path:'docs/campaign-second-policy.json',sha256:hash(readFileSync('docs/campaign-second-policy.json'))},activation:false,connectorMapping:'Three versions/names verified by remote readback after explicitly authorized connector installation; repository filenames and fixture references aligned without history repair.'};
writeFileSync(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
writeFileSync(`${dir}/SHA256SUMS`,migrations.map(m=>`${m.sha256}  ${m.payload}`).join('\n')+'\n');
console.log('Packaged 3 unchanged raw DDL payloads with verified applied history; this script makes no remote changes.');
