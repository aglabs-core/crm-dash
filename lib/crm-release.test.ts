import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read=(p:string)=>readFileSync(p,'utf8');
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest=JSON.parse(read('release/crm-dormant/manifest.json'));
test('integrated release payload order, byte identity and connector mapping are explicit',()=>{
 const files=readdirSync('supabase/migrations');
 let previous='20261102203544';
 for(const m of manifest.migrations){
  assert.ok(m.repositoryVersion>previous);assert.equal(m.dependsOn,previous);previous=m.repositoryVersion;
  assert.equal(m.appliedVersion,null);assert.equal(m.appliedName,null);
  assert.equal(hash(m.migration),m.sha256);assert.equal(hash(m.payload),m.sha256);
  assert.ok(!files.some(f=>f.startsWith(m.originalVersion+'_')));
  for(const script of ['scripts/test-campaign-executor.mjs','scripts/test-campaign-legacy-second.mjs']){
   assert.ok(read(script).includes(`${m.repositoryVersion}_${m.name}.sql`));
   assert.ok(!read(script).includes(`${m.originalVersion}_${m.name}.sql`));
  }
 }
 for(const m of manifest.appliedPrerequisites)assert.ok(files.includes(`${m.version}_${m.name}.sql`));
 assert.ok(!files.includes('20261102183000_guard_email_ledger_bindings.sql'));
 assert.ok(!files.includes('20261102183500_campaign_followup_review.sql'));
});
test('approved text, delivery wait and dormant defaults are frozen without provider setup',()=>{
 assert.equal(hash(manifest.policy.path),'07f1a5fa33fa3220129c1f0c7b8754006baf7d46c420451b285112d712143c98');
 assert.equal(hash(manifest.policy.path),manifest.policy.sha256);
 const p=JSON.parse(read(manifest.policy.path));
 assert.equal(p.enabled,false);assert.equal(p.productionActivationApproved,false);assert.equal(p.recipientBatchApproved,false);
 assert.equal(p.maximumSecondMessages,1);assert.equal(p.waitSeconds,604800);assert.equal(p.waitAnchor,'initial.delivered_at');
 assert.equal(p.subject,'Conseguiu conhecer o Barberias?');assert.equal(p.format,'text_only');
 assert.match(read(manifest.migrations[0].migration),/enabled boolean NOT NULL DEFAULT false/);
 assert.match(read(manifest.migrations[0].migration),/wait_seconds integer CHECK\(wait_seconds BETWEEN 1/);
 assert.match(read('lib/campaign-execution.ts'),/CRM_CAMPAIGN_SECOND_ENABLED!=='true'/);
 assert.doesNotMatch(read('.env.example'),/CRM_CAMPAIGN_SECOND_ENABLED|BREVO_API_KEY|CRM_CAMPAIGN_BREVO_BINDING/);
 const page=read('app/(dashboard)/campaigns/[id]/page.tsx');
 assert.equal((page.match(/<CampaignFollowupReview /g)||[]).length,1);
 assert.equal((page.match(/<CampaignApproval /g)||[]).length,1);
});
