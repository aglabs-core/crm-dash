# PR67 NULL attempt-token fence correction

Baseline: 9167afeb544085623a95003eaf6fb74b20b2b274. No merge/rebase or feature expansion.

Production delta: only two comparisons in the dormant migration change from `<>` to `IS DISTINCT FROM`. The stored token remains NOT NULL UUID; SQL NULL now differs from that token, malformed strings are rejected by PostgreSQL UUID input parsing, and only an exact current token passes the fence. Authentication and owner predicates are unchanged. No deployed database was migrated.

## Strict vertical RED → GREEN (real disposable PostgreSQL 17)

- `red-start.log`: exit 1, NULL start unexpectedly returned dispatch_started and frozen payload (expected fenced).
- Change only the start comparison.
- `green-start.log`: exit 0, original 24 + start regression = 25 checks, 6 loopback HTTP requests.
- `red-finish.log`: exit 1, NULL finish after a valid start unexpectedly returned accepted (expected fenced).
- Change only the finish comparison.
- `green-finish.log`: exit 0, 26 checks, 6 loopback HTTP requests.
- Supplemental already-green UUID parsing/owner isolation regression added without further implementation changes.
- `green-final.log`: exit 0, original 24 + 3 regressions = 27 checks, 6 loopback HTTP requests.

NULL start is repeated before and after claim token rotation; stale start remains fenced. NULL finish is repeated after valid start and token rotation; stale finish remains fenced. Repeated claims remain busy/dispatch_started. Full outbox row snapshots remain identical after rejected operations, with no accepted state or receipt and no additional HTTP. Supplemental checks cover empty/non-UUID strings, all-zero nonmatching UUID, and foreign-owner NULL/current-token calls in claimed and dispatch_started phases. Existing normal valid-token acceptance/replay and crash/restart checks remain green.

Image: postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24. Each invocation creates an isolated --network none container with no published ports, then removes and verifies absence of its exact container/anonymous volumes, including both RED runs.

## Gates

- `env -u NODE_ENV npm run check`: exit 0; lint, typecheck, 165 Node tests, 53 UI tests across 17 files, production build.
- `npm run audit:gate`: exit 0; 0 advisories, 0 exceptions.
- Terminal logs retain actual output; trailing terminal whitespace/CR progress formatting normalized only.

No provider access, real email, remote migration, scheduler, activation, parent-task closure or merge. Dormant defaults and unsupported-step restrictions unchanged. Final independent review remains required.
