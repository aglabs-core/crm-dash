# Brevo second-step execution — dormant, dependent on PR #69

## Installed code, not production activation

This branch adds a real Brevo transport and two **POST-only** Next entrypoints:

- `/api/campaigns/second/execute`: off unless server `CRM_CAMPAIGN_SECOND_ENABLED` equals the literal `true`.
- `/api/campaigns/second/reconcile`: authenticated bookkeeping of already accepted second sends, including while send flags are off. Does not require a provider key, read recipients, claim work, or call Brevo.

No schedule, environment value, production credential, SQL migration or campaign approval is installed/changed here. No real provider call, customer send, merge or deployment was performed. Existing `scripts/run-campaign-second-step.mjs` remains the **legacy loopback fixture CLI**, not the new production entrypoint. Do not configure that fixture as the production caller.

## Existing server configuration mechanism

Use the application's existing server deployment environment and existing Supabase owner-session authentication (`lib/email-content.ts`), not another secret store or client-provided grants. The handler uses `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` and verifies the request's bearer session with `auth.getUser`. The verified ID must equal the server-approved binding owner. All queries and executor RPCs retain that user's JWT/RLS; no service-role impersonation is introduced.

Reuse the existing server-only `BREVO_API_KEY` configuration name (also used by `scripts/backfill-email-ledger.ts`). Never put it or this binding in a `NEXT_PUBLIC_*` variable, request body, workflow export or browser code. This implementation reads no dotenv files and does not fetch account secrets.

Dormant settings (documentation only; **do not apply to production without acceptance**):

| Server variable | Required value / meaning |
| --- | --- |
| `CRM_CAMPAIGN_SECOND_ENABLED` | absent or `false` until explicit activation approval |
| `CRM_CAMPAIGN_BATCH_LIMIT` | explicit integer 1–5 (start with 1); request cannot override |
| `CRM_CAMPAIGN_BREVO_BINDING` | exact JSON object described below, no additional fields |
| `BREVO_API_KEY` | existing server key, never copied into a new variable; only needed to send |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing application configuration, no custom RPC URL |

Exact binding schema:

```ts
{
  ownerId: string;       // approved canonical CRM owner UUID, lowercase
  connectionId: string;  // existing email_provider_connections.id for that owner
  provider: 'brevo';
  sourceKey: 'crm.campaign.second';
  from: string;          // explicitly approved From, exact immutable comparison
  replyTo: string;       // separately approved public Reply-To, not inferred mailbox identity
  keySha256: string;     // server-side approved existing API-key SHA-256, 64 lowercase hex
}
```

There are deliberately **no concrete account/address/key values** in this repository. A valid shape is not account approval. A privileged operator must approve the exact account→existing-key-digest→connection→owner→From→Reply-To mapping through the existing deployment mechanism. Digest comparison prevents accidentally selecting another key locally; it does not prove Brevo permissions, account identity or sender verification online. Those remain activation requirements. No keys should be requested in chat.

## Effect boundary and receipts

1. Off returns `{"status":"disabled"}` before configuration parsing, authentication network, customer reads, claims or provider I/O. Body/query cannot enable anything.
2. On requires bearer authentication syntax and an empty request with no query. Local binding/key/limit preflight precedes even authentication I/O.
3. Verify owner session and exact existing owner-scoped `email_provider_connections` row (`id,user_id,provider`), before reading customer work.
4. The existing bounded `list_campaign_second_work` RPC selects only approved second-step work, never a legacy list. Before each claim, read that owner's frozen `second_message`; require exact approved From/Reply-To, valid recipient, subject and text. No template rendering or HTML substitution.
5. Existing claim/start RPCs retain durable dedupe and token fencing. `start_campaign_dispatch` transaction revalidates pause, eligibility, response, opt-out, payment/trial, failure/suppression, delivered-parent clock and immutable recipient identity **after claim**, immediately before provider dispatch. No new SQL or alternate eligibility implementation. As with the original executor, a revocation committed after that transaction cannot retract an already-started network effect.
6. Provider validates the start receipt's immutable message again, then makes exactly one `POST https://api.brevo.com/v3/smtp/email`, no redirects or retries, fixed 5-second abort deadline. Payload is `sender.email`, one `to[].email`, `replyTo.email`, approved `subject` and `textContent`. No CC/BCC, URLs, provider key or account override from client input.
7. Only HTTP 201 with an exact one-field JSON `{messageId: string}` receipt is accepted. Body capped at 4096 bytes; ID must be a bounded `<local@domain>` provider identifier (not proof of RFC thread availability or delivery). Any timeout, malformed receipt, HTTP error or exception after start goes through the existing uncertain finish, never automatic resend. Lost start/finish commit responses preserve durable fences.
8. Accepted receipt publication uses the existing exact immutable ledger RPC. Reconciliation is separately callable while off and never resends. Responses expose only bounded execution status, processed count and allowlisted per-item status/ledger outcomes (max 5); `complete` means the bounded loop completed, **not delivery or acceptance of every item**. Unknown internal reason strings become `review`; use durable authorized state for detailed review. No addresses, content, provider IDs or attempt tokens are returned or logged.

## Scheduler/caller inspection

- `vercel.json` contains deployment configuration only, **no `crons`**. Both new routes export POST only; native Vercel Cron's GET invocation is not a suitable direct caller.
- `.github/workflows/quality.yml` runs quality/audit/disposable PostgreSQL tests and an optional main-only deploy hook; it is not a campaign scheduler.
- Versioned `integrations/n8n/` contains Asaas payment mapping/workflow-update artifacts, **no campaign sender timer or credential-bound caller**. Existing Brevo callback ingestion (`/api/integrations/brevo/webhook`) and ledger/history sources are untouched.
- The prior one-shot CLI accepts owner-session RPC configuration but deliberately restricts its provider to loopback. It is retained for upstream regression proofs, not presented as a real Brevo caller.

For a future owner-approved existing n8n/manual server caller: make an empty POST to the appropriate route with a currently valid **existing owner-session** bearer credential managed by that trusted caller, limit set only server-side. No body, query, owner selector or raw key. This patch does not create an n8n workflow, install a cron, add a queue/service, provision/refresh credentials or claim a live scheduler exists. Never call execute to smoke-test deployment. Off readback may be verified safely separately; live controlled acceptance requires explicit authorization.

## Blocking real activation requirements

- Independent review and ordered merge/deployment of dependency PRs, with migration filename reconciliation first. Parent reports applied guard/readiness migrations as `20261102203246_guard_email_ledger_bindings_20261102183000.sql` and `20261102203544_campaign_followup_review_20261102183500.sql` (PR #68 head `c65202c64729b015c3d32e30275f3b308705c991`). This stacked branch intentionally does not rename or duplicate migrations. The executor/second-step SQL is **not installed remotely** by this work.
- Exact privileged production account/key/connection/From/Reply-To approval and configuration, live sender/API permission verification by the responsible owner; no inferred account identity.
- Existing authenticated owner-session caller and renewal/revocation operational proof; no production cron currently wired in this repository.
- Database executor control remains off by default; separately review/install prerequisite RPCs, explicit approved seven-day delivered-anchor policy and a reviewed frozen recipient batch. Rule approval is not batch approval or activation.
- Controlled staging proof of installed JWT/RLS authorization, pause/revocation, no-resend uncertainty, strict acceptance, ledger readback and existing callback/reply continuity with Maia. Local synthetic tests do not establish these live layers.
- Explicit activation and scheduler acceptance; production rollback is disabling admissions and preserving/reconciling accepted/uncertain outbox evidence, never clearing claims to retry.

This is a text-only approved-message vertical; it does **not** establish frozen HTML shell/visual identity readiness. Existing Brevo callbacks, provider history, Maia intake/reply routing and historical-worker work remain unchanged.

## Verification

`lib/campaign-brevo.test.ts` and `lib/campaign-execution.test.ts` are included automatically by the existing `npm test` / `npm run check` glob. All HTTP transport is synthetic/in-process; no real API keys or provider calls. TDD RED/GREEN evidence is in `evidence/campaign-brevo/`; already-green supplemental edge/regression tests are labeled separately in its README. `npm run test:campaign-executor` independently exercises the unmodified dependency SQL on disposable PostgreSQL and loopback HTTP, including worker death/restart and no-resend fencing.

Provider contract reference: https://developers.brevo.com/reference/send-transac-email . `messageId` acceptance is distinct from delivered callback evidence.
