# Historical second-step bridge — dormant, text-only

Depends on PR #69 (`ff28733619b64cbf6169c9f4d5d124de83ef9954`). Includes PR #68's exact registered migration filenames and delivery-anchor correction (`c65202c64729b015c3d32e30275f3b308705c991`); the old filenames are removed, not duplicated. No migrations in this PR were applied remotely.

## Contract

- Reuses `email_campaign_batches` and `email_campaign_batch_recipients`; the new `batch_kind=legacy_second` is a **historical import**, not approval of a new initial message.
- Preparation creates `state=draft`, `approved_at=NULL`, `second_approval=NULL`, an import note and a random version identity in the existing required `approval_key` column. It creates **no outbox**, initial approval, provider effect, contact, campaign or recipient.
- Copies each original recipient-bound ledger parent: technical ledger owner → permitted contact-owner bridge → owned campaign/recipient → contact/address/product. Retains original provider ID, original sender/Reply-To, subject, body text, sent and delivered timestamps. Campaign's current offer/template is never used to reconstruct the original.
- Freezes exactly `barberias-prospect-second-v1`, subject **Conseguiu conhecer o Barberias?**, and the approved text in `docs/campaign-second-policy.json`, rendered once per recipient. The PG test checks the SQL policy against that document. No extra cadence, copy or subject is supplied by the client.
- **Text-only draft.** Does not recover/freeze original HTML, claim visual fidelity, select a mutable visual template or send HTML. Missing original text/envelope/receipt or delivery is a blocking reason. A campaign with no bound ledger parent is refused rather than invented.
- Owner must individually select recipients and record an explicit review note in the existing campaign-detail second-step panel. Excluded recipients remain in the frozen audit but are not selected. UI and RPC do not send, schedule, claim, activate or change contact stages.
- Server requires **604800 seconds from the parent's confirmed delivered_at**, at review/approval and again in the existing second-step admission/start path. `approved_at` and `sent_at` do not start this clock. One second message maximum remains enforced by existing person/address/product/step uniqueness and ledger-history stops.
- Missing delivery, reply, account/trial, payment, bounce/failure/deferral, opt-out, suppression, changed binding, duplicate address, later approach and repeated initial rendered text exclude a recipient. Null cold-pool cannot enter because the existing schema rejects it. These controls cannot prove facts absent from the CRM.
- A stale review cannot be approved. Cancel the immutable version, review again and prepare another; cancellation retains its audit. Exact replay and concurrent preparation/approval converge on one version. Generic batch-state control cannot manufacture its approval. Generic initial dispatch returns `legacy_second_only`, even with executor controls enabled in the isolated fixture.
- Existing second runner accepts the frozen historical parent directly; **no new initial messenger/outbox is needed**. The isolated proof performs one synthetic loopback second send and publishes it linked to that parent; replay never resends. Production controls and provider setup remain off and were not touched.

## After reviewed installation: prepare only, do not approve or send

Use the authenticated campaign owner's session (existing Supabase client / authenticated RPC transport). Do not impersonate another owner with an administrative SQL connector. First inspect the explicit campaign IDs and their reviews:

```sql
-- Read-only, one explicit campaign ID selected by the owner.
select public.review_campaign_legacy_second(:campaign_id::uuid);
```

Persist that exact reviewed fingerprint, without batch approval:

```sql
select public.prepare_campaign_legacy_second(
  :campaign_id::uuid,
  :review_fingerprint::text
);
-- Exact readback, in a subsequent request:
select public.get_campaign_legacy_second(:campaign_id::uuid);
```

For the already identified historical campaigns, repeat only for those owner-reviewed campaign IDs. Do not enumerate every campaign or silently attach the three campaign-less historical messages: their original campaign/recipient bindings are absent and need a separately evidenced decision. Preparation intentionally keeps ineligible recipient rows and reasons in the draft for inspection.

Expected new-version readback: `state=draft`; frozen `review.policy` as above; `second_approval=null`; `approved_at` is NULL in the owner-visible batch row. No owner recipient-batch approval has been granted. **Stop here for PREPARAR LOTE.**

Only a later explicit owner action uses `approve_campaign_legacy_second(batch_id,fingerprint,recipient_ids_json,key,note)`, after inspecting every selected original and final message. This is not authority to enable `dispatch_control`, configure a provider, run the CLI or activate a scheduler. UI preparation/approval performs exact target readbacks. All production installation/activation requires its own reviewed procedure.

## Gates and evidence

- `env -u NODE_ENV npm run check`: lint, typecheck, logic/database tests, mounted UI tests, production build.
- `npm run test:campaign-executor`: existing 4 runner controls + 45 real PG17/HTTP regressions from #69, then 23 new real PG17 historical-bridge checks. Separate task-owned containers/anonymous volumes, network none for PG, no published DB ports, verified exact cleanup. HTTP is loopback and synthetic only.
- `npm run audit:gate`: production dependency gate, separate from all-dependency audit.
- `evidence/campaign-legacy-second/` preserves missing-RPC schema RED, missing mounted behavior UI RED, rendered-repeat behavioral RED, intermediate failed probes and final outputs. Main-page consumer test is supplemental regression. The attempted NULL cold-pool mutation failed at the pre-existing NOT NULL constraint, not a new behavioral RED; it became an explicit supplemental rejection assertion. One main-page test initially failed because React Suspense needed awaited `act`; its corrected result is retained separately.

No remote PostgREST acceptance, production UI login, migration installation, real delivery, historical recipient approval or activation is claimed. Roll back the frontend to its prior commit and retain imported audit rows with the executor off; do not drop historical snapshots or rewrite ledger history as an automatic rollback.
