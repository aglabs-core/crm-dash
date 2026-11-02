# Evidence map — dormant CRM second step

- `19-final-pg17-http.log`: final executable proof; 4 routing/runner checks + 45 PostgreSQL 17.11 checks (27 original + 18 new), 11 synthetic provider requests. Includes child-process CLI over separately authenticated loopback RPC and exact PostgreSQL/ledger readbacks. Containers/own volumes removed.
- `16-check-retry.log`: `env -u NODE_ENV npm run check` exit 0; lint, typecheck, 165 Node/PGlite tests, 53 UI tests and Next production build.
- `17-audit.log`: production audit gate exit 0, zero advisories/exceptions.
- Final `npm run lint`, `git diff --check`, disabled CLI and executor suite were rerun after the unsupported-step guard.
- RED→GREEN artifacts retained under their actual chronological names. `13` catches rendered repetition; `14` catches failed status without an event; `18` catches an unsupported step silently falling back to initial. `05` is a preliminary test-harness attempt, not the behavioral RED (`07`). `11` is a lint failure fixed by renaming a test variable; do not present it as a passing gate.
- `01`/`03`/`08` prove earlier missing behavior before implementation. Extra safety tests already passing on their first execution are supplemental regressions, not test-first REDs.

No production `.env`, provider credentials, customers, remote migrations, real mail, cron activation, merge or deployment were used. Generic loopback HTTP is not installed Brevo/PostgREST authentication. The original SIGKILL/restart proof covers initial; no second-specific crash proof is claimed. Full limits and saved owner policy are in `docs/campaign-second-step.md` and `docs/campaign-second-policy.json`.
