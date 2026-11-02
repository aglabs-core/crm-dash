# Evidence — dormant Brevo adapter and authenticated caller

Candidate stacks on PR #69 `ff28733619b64cbf6169c9f4d5d124de83ef9954`. Independent isolated clone `/home/ubuntu/crm-brevo-executor`; reference checkout untouched. No SQL migration, historical worker, live deployment configuration, credential, campaign or scheduler changed.

Behavioral TDD slices (actual failing assertions, not missing-import errors):

- `01-red-payload.log` → `02-green-payload.log`: generic HTTP payload is not Brevo's single-recipient SMTP text contract.
- `03-red-binding.log` → `04-green-binding.log`: immutable Reply-To mismatch must prevent HTTP.
- `05-red-receipt.log` → `06-green-receipt.log`: malformed/extra/untyped receipt cannot establish acceptance.
- `07-red-auth.log` → `08-green-auth.log`: authenticated endpoint cannot be a disabled-handler placeholder when on.
- `09-red-preclaim.log` → `10-green-preclaim-regressions.log`: frozen From mismatch must stop before durable claim.
- `11-red-route.log` → `12-green-route.log`: actual Next entrypoint must be wired, dormant by default.
- `17-red-public-receipt.log` → `18-green-public-receipt.log`: public receipt must distinguish acceptance/publication using allowlisted non-PII outcomes.
- `19-red-id-control.log` → `20-final-transport-caller.log`: provider identifier cannot contain ASCII NUL/control data.

Supplemental already-green tests cover missing/null/invalid binding, key digest mismatch, source/account/address mismatch, default off/zero I/O, forged body/query, verified foreign owner, missing/mismatched RLS connection, post-claim start denial, acceptance dedupe, timeout uncertainty/no resend, reconciliation off without provider, strict HTTP status, extra message fields, oversized provider receipt and actual five-second abort signal with mock transport. These are not claimed as independent RED slices.

Final results:

- `20-final-transport-caller.log`: 18 new adapter/caller tests pass (synthetic in-process transport; no live key or provider network).
- `21-final-check.log`: exact `env -u NODE_ENV npm run check` passes lint, TypeScript, 183 Node tests, 53 UI tests and Next production build; both new POST API routes appear in build output.
- `14-executor-regression.log`: existing runner assertions pass; 45 durable PostgreSQL 17.11 checks, 11 loopback HTTP requests, worker kill/restart/no-resend proof; disposable container and exact anonymous volumes removed.
- `15-audit.log`: existing production dependency audit passes with zero evaluated advisories/exceptions.
- Earlier aggregate logs `13`, `16` are pre-final checkpoints, not the final candidate.

Local dependency symlink points at the reference checkout's existing node_modules; no package/lockfile edits. Build output is task-local. SQL regression uses its existing disposable fixture, not Supabase. The fixture CLI is still loopback-only by design; production HTTP entry is the new Next route. The mock-network caller uses the actual Supabase SDK/auth/read/RPC code but does not prove installed PostgREST JWT/RLS or Brevo account authorization online.

This is implementation and local verification, not a real send, delivery, callback/first-reply continuity proof, scheduler installation or activation. Full remaining production gates and exact dormant configuration are in `docs/campaign-brevo-entrypoint.md`. Parent task is intentionally left open.
