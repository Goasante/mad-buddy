# UpFor and Meet Up production release

Verified on 6 October 2026 at approximately 18:23 UTC.

| Item | Verified value |
| --- | --- |
| Repository | Goasante/mad-buddy |
| PR | #138 |
| Tested candidate | 2271bd1c7715201813c6b21655dd9ad57f7d6427 |
| Production main | 31ab9bd453ca2643f9b74b6ca50e2cdd2b9e7e1e |
| Vercel project | prj_K9d6r0fZnA9vwxFablpu0kxYEugJ |
| Vercel team | team_D5Sb0Jx7L4qe0AAZvnm5s1qY |
| Deployment | dpl_BafLTzjBHgmENj2Lw3Yx4PHSwQXr |
| Canonical domain | https://mad-buddy.com |
| Production Supabase | cabkhxxnrybzhkbtoiiz |
| Production migration count/head | 177 / 20261006161651 |
| Release flags | upfor=on, safe_arrival=on; both default_value=true |

The two migrations were first applied to staging, then to Production before
merging the application release. MCP-generated history records were aligned
to the repository's canonical migration versions; migration SQL was unchanged.
No unrelated schema or user-data changes were applied.

All four Meet Up tables have RLS enabled, with no browser-role privileges.
The six new RPCs are invoker functions with an empty search path; only the
service role has execution authority. A service-role empty-actor projection
returns an empty array. Future UpFor discovery policies no longer require
starts_at <= now(). Audience predicates remain in place.

The database advisor reports informational RLS-without-policy notices for
these four tables. This is intentional for server-only tables: browser roles
have no grants. Do not add browser policies to silence the notice. Reference:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Local validation passed 9,456 root tests, 26 native tests, 34 isolated
PostgreSQL checks, lint, and web/native builds. All three CI jobs passed on
the final candidate. The runtime audit reports zero vulnerabilities after
updating locked Capacitor packages, sharp and source-map-js.

Live-domain checks after enabling the flags:

- /api/version returns the exact production main SHA and deployment ID.
- /api/health and /api/health/readiness return 200 with ok=true.
- /login returns 200.
- /meet-up, /plans and /safe-arrival redirect signed-out requests to login.
- GET and POST /api/meetups return 401 without authentication.
- The existing cron-tick-5min job is active at */5 * * * *.

Existing Plans, Plan Chat conversion, Home Plans/Events cards and legacy
journey completion remain supported. Native UI code builds, but this release
does not publish an Android/iOS store binary. Real-account browser flows,
OS push delivery and device proximity behavior still need direct checks.
Local Supabase integration tests could not run without the local stack and
credentials; isolated database checks are not substitutes for device proof.

Rollback: disable upfor and safe_arrival first, then restore the last reviewed
healthy application deployment dpl_CDjd6nJvmVncz5u2SNjVS3P1iDAn, commit
ebd220de4d3d3fb7b1b7c258bc7ab7c96f49f99d. Keep the additive migrations and
all user data; never drop Meet Up or journey records as a code rollback.
