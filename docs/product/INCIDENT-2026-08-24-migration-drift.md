# 2026-08-24 — "production migration drift" — NOT AN INCIDENT

**Classification: A — ATTRIBUTED TO OUR KNOWN SEED PROCESS.**
No production mutation occurred. No unauthorized access occurred. The alarm was
caused by a tooling mistake in the investigation itself, recorded here because
the mistake is repeatable and the next person deserves the warning.

## What was reported

During the production push preflight I reported that all six pending migrations
appeared to be already applied to production out-of-band, and that
`access_grants` held 7 unexplained rows — 5 `welcome_access` and 2
`admin_grant` — created within 1.4 seconds on 2026-08-24 11:46 UTC, during the
window when an exposed `service_role` key was live.

That report was **wrong**.

## What was actually true

`supabase db query` **defaults to the LOCAL database**. It requires `--linked`
to reach the remote project. Every schema query in that preflight ran against
the local Docker Postgres and was reported as production.

The tell was in the output the whole time:

```
Connecting to local database...          <- local
Initialising login role...               <- remote
```

Confirmed by asking the database where it was:

```
local       server_addr = 172.18.0.6         (the supabase_db_mad-buddy container)
production  server_addr = 2a05:d018:...      (public IPv6)
```

### Production, verified with `--linked`

| Object | Production |
| --- | --- |
| `access_grants` | **does not exist** |
| `access_global_windows`, `access_reminder_log`, `access_launch` | do not exist |
| `subscription_plan` enum | `free, buddy_plus, buddy_pro` — no `mad_buddy_access` |
| `activation_milestones` CHECK | no `first_reply_received` |
| `friendships_start_welcome_access` trigger | absent |
| `messages_record_first_reply_received` trigger | absent |
| `is_conversation_member` | absent |
| UpFor `football` category | absent |
| Migration history ≥ 20260820 | `20260820120000` only |

Production is **exactly** where the migration history says it is. Nothing was
applied out-of-band. There is no drift.

### The 7 grants

All 7 are in the LOCAL database, and all 7 are mine:

- every row carries `reason: "Monetization owner review cohort"`, the literal
  string in `scripts/hardening/seed-monetization-review.mjs:149,182`
- 7/7 belong to `accessday1`, `accessday10`, `accessday13`, `accessgranted`,
  `accessindef`, `accessexpired` — the seeded review cohort
- the split matches the cohort spec: 2 `admin_grant`, and 5 `welcome_access`
  (the spec lists 6, one of which belongs to the `accessnone` persona that
  deliberately receives none)
- the 1.4-second spread is one script run, which is what it looked like
- production has **0** accounts matching `access%`

The two `admin_grant` rows — the detail that most warranted suspicion — are
`accessgranted` (expired welcome + live 7-day grant) and `accessindef`
(indefinite grant). Both are documented personas.

## Why this took a false-alarm escalation to catch

The earlier `supabase migration list` **was** correct: it showed six pending,
and it reads the remote. The follow-up schema queries silently switched target
and I did not check. Two things would have caught it immediately:

1. **Reading "Connecting to local database..."** — it was printed on every one
   of those queries.
2. **Asking the database to identify itself** before trusting any answer about
   production state.

The pattern to keep: *a query that reports on production must prove it reached
production, in the same breath.*

## Rule going forward

**Never run `supabase db query` without an explicit target flag.** Use
`--linked` for production and `--local` for local, always, even when the default
would be right — because the default is invisible in the command and visible
only in a log line that is easy to scroll past.

Every production query in this repository's runbooks must pass `--linked`.

## Standing correction

An earlier memory note said the Vercel CLI auth was stale. It is not: the CLI
is authenticated, the project is `mad-buddy`, and the production alias is
`https://mad-buddy.com`.

## Outcome

| Question | Answer |
| --- | --- |
| Production mutated? | **No** — every query this session was read-only |
| Migrations applied out-of-band? | **No** — production is at `20260820120000` |
| Unattributed grants? | **No** — 7/7 are local review-cohort seeds |
| Related to the exposed key? | **No** — timing coincidence; the rows never touched production |
| Release state | still frozen, 6 migrations still pending, nothing pushed |

The credential exposure earlier that day was real and the remediation was
correct. This second alarm was not related to it.
