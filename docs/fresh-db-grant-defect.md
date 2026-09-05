# Fresh-database grant reproducibility defect

## Symptom

A brand-new hosted Supabase project (Mad Buddy Staging) received all 124
repository migrations successfully. The schema was correct. The database was
still unusable by the server:

```
service_role SELECT   ≈ 31 / 191 public tables
service_role INSERT   ≈ 27 / 191 public tables
API result            42501 permission denied for table <x>
```

## Root cause

Migrations run as `postgres`. On a freshly provisioned project, `pg_default_acl`
carries **two competing entries** for tables in `public`:

| grantor | ACL for anon / authenticated / service_role |
| --- | --- |
| `supabase_admin` | `arwdDxtm` — full DML |
| `postgres` | `Dxtm` — TRUNCATE/REFERENCES/TRIGGER/MAINTAIN only |

A table created by a migration inherits the **`postgres`** entry, so it gets no
`SELECT`/`INSERT`/`UPDATE`/`DELETE` for any Supabase role.

Nothing in migration history compensated. Across all 124 prior migrations:

- `ALTER DEFAULT PRIVILEGES` — **0 occurrences**
- `GRANT ... ON ALL TABLES IN SCHEMA public` — **0 occurrences**
- explicit per-table `service_role` grants — **10**, in three migrations
  (premium trials, experiments, `scheduler_incidents`)

Those ten, plus tables covered by the platform snapshot, are precisely why a
minority of tables worked.

### Correction to an earlier attribution

An earlier note in this investigation named
`20260719160000_client_exposure_security_hardening.sql` as the cause. **That was
wrong.** Reading it: all 20 of its `REVOKE` statements target `anon`,
`authenticated` or `public`, and its only `service_role` references are nine
`GRANT EXECUTE` statements. It never revokes anything from `service_role`.

The defect is not one bad migration. It is that **migration history depended on
ACL state supplied by the platform rather than asserted by the repository.**

### Why production is unaffected

Production predates this and carries default-privilege state granting DML on
newly created tables. It has always worked — which is exactly what hid the
problem. The schema was reproducible; the ACLs were not.

The repository already documented a sibling case in
`20260830160000_upfor_claim_grant_hardening.sql`, where production's default
privileges silently granted `EXECUTE` that a migration believed it had revoked.
Same class of defect, opposite direction.

### The stale local-stack note

`scripts/hardening/local-db-grants.sql` described this exact ACL shape but
concluded it was "a property of the local stack, not drift and not a repo
defect", attributing it to local Postgres 17.6 vs `config.toml`'s
`major_version = 15`.

The new hosted project reports **`server_version = 17.6`**. Newly provisioned
hosted projects behave the same way, so the local-only conclusion was wrong and
has been corrected in that file.

## Repair

`supabase/migrations/20260903120000_service_role_grant_reproducibility.sql`

1. `GRANT USAGE ON SCHEMA public TO service_role`
2. `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES ... TO service_role`
3. `GRANT USAGE, SELECT ON ALL SEQUENCES ... TO service_role`
4. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...` for tables **and** sequences

Step 4 is what stops the next migration that creates a table from
reintroducing the defect for that table. `FOR ROLE postgres` is required:
without it the statement applies to the current role and silently does nothing
for objects owned by another.

Idempotent, and safe to apply to a database that already has these privileges.

## Manual staging repair vs the migration

The staging project was repaired by hand so seeding could continue. Exact SQL
applied:

```sql
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;
```

Differences from the committed migration, and why:

| Manual repair | Migration | Reason |
| --- | --- | --- |
| `usage on schema` to all three roles | `service_role` only | anon/authenticated already had schema usage; granting it again was harmless but wider than needed. |
| `all privileges` on tables | `select, insert, update, delete` | `ALL` includes TRUNCATE/REFERENCES/TRIGGER; DML is what the server actually needs. |
| `all privileges` on functions | *(omitted)* | Function EXECUTE authority is deliberately unchanged; several migrations tune it precisely and a blanket grant would undo that. |
| no default privileges | `ALTER DEFAULT PRIVILEGES` | The manual repair fixes only tables that exist *today*. Without defaults the next new table breaks again. |

**The manual repair is evidence, not authority.** It is deliberately not what
was committed.

## Verification status

Applying this migration to the already-hand-repaired staging database would
prove almost nothing — the grants are already there.

The real gate is a rebuild from zero:

```
EMPTY hosted project
  → 125 migrations (124 + this repair)
  → NO hand-applied grant SQL
  → service-role API works
  → 100 synthetic users seed successfully
  → Realtime 5/5
  → seed rerun idempotent
```

Until that runs: **code fix ready, hosted clean-rebuild proof pending.**
