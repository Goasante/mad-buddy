# Database Operations Runbook

Mad Buddy uses Supabase PostgreSQL as canonical server truth. This runbook exists to prevent accidental Production operations and to preserve reproducible migration history.

## Environment identities

At the creation of this runbook:

- Production project ref: `cabkhxxnrybzhkbtoiiz`
- Staging project ref: `ivaydmciwmjdjsrovbqb`
- Production migration count: **137**

A project ref is not a secret, but targeting the wrong ref is an operational hazard.

## Hard-stop rule before destructive commands

Immediately before any command such as remote reset, push, seed, migration repair, or destructive SQL:

1. Read the linked project ref from the actual working directory.
2. Compare it to the intended target.
3. Stop if it does not match exactly.
4. Stop if Production appears during a staging/local destructive workflow.

Do not infer target from:

- worktree path,
- branch name,
- terminal title,
- `.env` filename,
- who ran the command last,
- memory.

## Local development

Typical local stack:

```bash
npx supabase start
```

Use Docker/local Supabase for destructive experiments and migration replay whenever possible.

Relevant project config is in `supabase/config.toml`.

## Migration authority

- `supabase/migrations/` is canonical schema history.
- A Production hotfix is not finished until the equivalent durable migration exists in Git.
- Do not manually repair Production, forget to capture the change, then let fresh environments recreate the old defect.
- Migrations should be replayable from zero against an isolated environment.

## Production migration procedure

Before applying:

- confirm intended `main`/release SHA,
- inspect migration files and order,
- confirm Production project ref,
- check remote migration head/pending state,
- identify whether migration is additive/destructive/data-transforming,
- establish rollback/forward-fix strategy,
- confirm no unrelated local migration files will be pushed.

After applying:

- verify expected migration count/head,
- confirm zero unexpected pending migrations,
- run targeted schema/RLS/RPC proof,
- run application runtime proof for affected domain,
- record the Production migration state in `docs/product/CONTINUATION.md`.

## RLS and browser authority

RLS/database grants are security boundaries.

- Browser roles (`anon`, `authenticated`) receive only intended table/RPC authority.
- Service-role operations are privileged and must be reached only through server-side authorization.
- Never solve a browser permission bug by granting broad table access without domain review.
- New `SECURITY DEFINER` functions must have explicit EXECUTE authority; do not rely on permissive defaults.

The schema-wide browser-authority security programme is recorded as closed at the 137-migration Production baseline. Do not reopen or weaken it casually.

## Production data policy

Production must never be used for:

- fixture seeding,
- load testing,
- reset/replay experiments,
- arbitrary negative probes that mutate real users,
- testing with known real users simply because their credentials are available.

Use local/staging synthetic identities.

## Staging policy

Staging is intended to remain synthetic-data-only.

The detailed reset/rebuild authority is `docs/staging-reset-procedure.md`.

When validating migration reproducibility, prefer:

1. isolated/staging reset,
2. full migration replay,
3. proof before any manual grant/repair SQL,
4. synthetic seed,
5. idempotency/isolation proof.

If manual SQL is required to make a supposedly reproducible migration pass, the migration is not yet proven.

## Database map

`docs/database-map.md` records domain → table realization and intentional divergences.

Important high-level facts:

- Supabase Auth owns user/session identity.
- User location storage is latest-row state, not a movement history.
- Messages use `(sender_id, client_message_id)` uniqueness for send idempotency.
- Admin/audit/safety event ledgers include append-only domains.
- State transitions should go through canonical domain rules/RPCs rather than unconstrained status updates.

## Backups and restore

Repository code cannot prove Supabase plan/backup state.

The owner/operator must verify in Supabase:

- managed backup/PITR availability,
- retention/recovery window,
- last successful backup,
- region,
- who can restore.

Run a restore drill into an isolated non-production project on a periodic schedule. Never test restore by overwriting Production.

If manual exports are used:

- encrypt immediately,
- keep off Git and off the web deployment,
- store in access-controlled off-site storage,
- apply retention/deletion policy,
- test restoration,
- treat dumps as highly sensitive because they may contain private profile, billing, message, and location-processing data.

## Schema/type synchronization

The repository uses generated/hand-synced database typings under `lib/supabase/database.types.ts` and many explicit select/filter contracts.

After schema changes:

- update typings/contracts as required,
- typecheck,
- run domain tests,
- verify fresh-db replay when the change affects grants/functions/schema assumptions.

## Incident response

If a migration targets the wrong environment or produces unexpected Production behavior:

1. stop further writes/deployments,
2. record exact project ref, migration/version and timestamp,
3. do not hide/repair evidence before understanding the impact,
4. protect/backup current data state where appropriate,
5. determine forward-fix vs rollback with data-preservation priority,
6. update migration history so the durable repository matches the final state,
7. record the incident and prevention rule.

Never improvise a destructive rollback solely to make migration numbers look tidy.
