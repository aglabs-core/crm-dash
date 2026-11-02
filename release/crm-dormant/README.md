# Integrated dormant CRM release

Base: `bd99e4423c6a1ad28a982708bca44a7098939949` (main includes #66 and #68). Normal merge commits integrate exact reviewed heads #67 `f6c935041da3c81f0e239073bd19853c72fcbf25`, #69 `ff28733619b64cbf6169c9f4d5d124de83ef9954`, #70 `a69813cdfef22447fd209ae988bad5e2bb5f5f31`, #71 `120063efd50a9ec40935e856ac573168d21cc663`. Original branches are unchanged. #68 was squash-merged by parent into main, so its reviewed tree is preserved through main, not falsely asserted as an ancestor.

## Contents and conflict resolution

- Keep applied guard `20261102203246_guard_email_ledger_bindings_20261102183000` and review `20261102203544_campaign_followup_review_20261102183500`; do not resurrect old duplicate migration files from #67.
- Keep main's delivery-clock regression test and review migration (`delivered_at`, not `sent_at`); resolve only the two #67 conflicts in favor of this newer applied state.
- #70 updates the one existing follow-up UI entry from main. There is exactly one follow-up card and one initial approval card; initial approval is not offered for provider-history campaigns. The historical prepare button creates only a review draft; a distinct explicit recipient approval action remains separate and neither sends.
- Adapter and runner remain off. UI text now says disabled by default, rather than incorrectly saying unimplemented. Preserve text-only warning; HTML is not reconstructed or promised.

## Ordered DDL — installed with sending disabled

`manifest.json` is the mapping file. The three `ddl/*.sql` files are separate **raw, byte-identical copies** of the reviewed migrations, including their transaction boundaries. Verify `sha256sum -c release/crm-dormant/SHA256SUMS` from repository root. No wrapper, API call, customer data, secrets or activation SQL is included.

| Order | Original version | Repository order version | Dependency |
|---|---|---|---|
| 1 initial dormant | 20261102200000 | 20261102212703 | applied review 20261102203544 + existing approval/ledger schema |
| 2 second | 20261102210000 | 20261102212748 | 20261102212703 |
| 3 historical draft | 20261102220000 | 20261102212834 | 20261102212748 |

The owner-authorized connector installed these three versions in order. Remote readback verified version/name, disabled control, empty batches/outbox, active guards and RPC permissions. Repository filenames, executable fixture references and manifest now match that actual history; `production-receipt.json` records the metadata. Stored statement MD5 equals each reviewed raw payload excluding its final LF. No history repair or duplicate alias was applied; do not reapply these migrations.

`readback-nonpii.sql` contains read-only metadata, policy and aggregate queries for the parent. It does not prepare/approve recipients or return addresses, bodies or receipt identifiers. Run complete script only after all dependencies exist; read history/counts before and after each apply separately. Parent preflight and post-installation readbacks both returned 165 contacts / 141 messages / 4 campaigns, zero batches/outbox; the earlier 140-message baseline was historical, not overwritten. The live database has independent traffic.

## Frozen policy and deployment boundary

Policy document SHA256: `07f1a5fa33fa3220129c1f0c7b8754006baf7d46c420451b285112d712143c98` (identical to #70). Exactly one second message, **604800 seconds after confirmed initial delivery**, subject **Conseguiu conhecer o Barberias?**, exact text from `docs/campaign-second-policy.json`, format `text_only`. A one-second explicit initial-dispatch wait is a separate existing gate; no default activation/configuration is added. Historical preparation is not approval or send.

No provider key, binding, env file, scheduler, cron, production preparation, approval or send is introduced by integration. Existing server code reads optional provider configuration only after gates; no configured provider is installed here. The three DDL migrations were installed by the parent under the explicit connector exception and remain OFF. Integrated publication and authenticated owner-session acceptance remain separate; frontend deployment is not evidence of live PostgREST acceptance.

## Verified locally

`evidence/crm-release/`: full `env -u NODE_ENV npm run check` (lint, typecheck, Node tests, UI tests, production build), production `npm run audit:gate`, disposable PG17 runner **45**, historical **23**, runner unit **4**, adapter **18**, payment and institutional PG gates. Integration adds manifest/hash/reference/default-off/UI-single-entry tests. Python PG tests initially lacked Docker permission; preserved failed attempt logs, reran successfully under sudo. Npm install reports development dependency advisories; production audit gate passed with no exception, and no unrelated dependency update was made.

## Rollback description (not executable destructive SQL)

Keep send disabled in both app and database, remove any future scheduling/configuration only under separate authorization, and revert frontend to prior published main if needed. Do **not** drop outbox, immutable approvals, ledger messages, snapshots or receipts, and never reinterpret uncertain/started effects as unsent. Schema migrations replace functions used by later migrations, so schema rollback requires dependency-aware independent review after confirming no claims/dispatches and preserving evidence. Prefer forward fixes with all send paths off. No automatic down migration is supplied.
