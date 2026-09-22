# Nullable contact consumer validation

Run `npm ci --include=dev` then `npm run test:ui`. The UI suite also runs inside
`npm test` / `npm run check`. Node 22 was used for validation.

The suite mounts the real React pages and UI components in JSDOM. Only the
Supabase module and Next router hooks are mocked; global fetch fails closed.
All records are synthetic (`example.invalid`); no environment file, production
credentials, real customers, database writes or migrations are needed.

Coverage:
- Contacts and Clients: API returns `name: null`; fallback label and avatar render;
  company search is case insensitive, no-match hides the row, clearing restores it.
- Contacts and Pipeline: open the actual edit modal; name input is empty and not
  required; edit company and click the actual submit button; assert the API update
  targets the expected contact and carries `name: null`, not an empty string or
  the display fallback; verify modal closes and fallback still renders.
- Contact detail: nullable name and initials render from the single-record API.

Validation against origin/main `838c8a6098b8c73fd2621b50b65db53247581eee`:
- Five mounted consumer tests pass without production code changes.
- Negative control: temporarily changing `contactNamePayload` to return an empty
  string made both actual-form tests fail with expected `null` / received `""`.
  Restoring the original helper returned all five tests to green. This mutation
  is not a discovered production bug and is not retained.
- `npm run check` passes (lint, typecheck, nine existing unit tests, five consumer
  tests, Next production build). `npm audit --include=dev` reports zero advisories.

Limitations: these are mounted DOM integration tests, not browser E2E or visual
QA. They do not validate deployed authentication, Supabase transport/RLS/schema,
realtime delivery, migration success, or every consumer (Tasks, global Search,
Dashboard, Reports and archived pipeline are not mounted here).

A quick scan of the baseline's 93 tracked files (86 text files) found no matches
for private key, GitHub/AWS/provider token, credential-bearing database URL or JWT
patterns. The only environment filename tracked was `.env.example`, with an anon
key placeholder. This is a bounded pattern scan, not proof that the public repo
has no secrets: Git history, GitHub artifacts/issues, binary assets and unknown
credential formats were not audited. No secret values were printed.
