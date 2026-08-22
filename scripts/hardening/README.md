# Hardening harness

Runtime verification tooling for the God Mode hardening program. The program's
rule is that source inspection cannot close a user-visible finding, so these
drive a real browser (Playwright + Chromium) against a real server and a real
database.

**Local only.** Everything here points at `http://localhost:3100` and the local
Supabase Docker stack. Nothing in this directory should ever be aimed at
production.

## Setup

```bash
# 1. Local Supabase (Docker) must be running.
npx supabase status

# 2. Repair the local stack's table grants (see local-db-grants.sql for why).
docker exec -i supabase_db_mad-buddy psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/hardening/local-db-grants.sql

# 3. Seed the test cast.
node scripts/hardening/seed-local.mjs

# 4. Run the app against LOCAL Supabase (.env.local must point at 127.0.0.1).
npx next dev -p 3100

# 5. Capture an authenticated session.
node scripts/hardening/login.mjs
```

Playwright is installed without touching `package.json`:
`npm install --no-save playwright@1.62.1`.

> **Git Bash note.** MSYS rewrites a leading `/` argument into a Windows path, so
> `--routes /login` silently becomes `C:/Program Files/Git/login`. Prefix
> commands with `MSYS_NO_PATHCONV=1`.

## Tools

| Script | Purpose |
| --- | --- |
| `seed-local.mjs` | Creates the 5-user test cast + friendships. Uses `admin.createUser({ email_confirm: true })`, never `auth.signUp`. |
| `local-db-grants.sql` | Restores DML grants the local Postgres 17.6 stack does not apply. Grants only — no policy, schema or data change. |
| `login.mjs` | Signs in through the REAL login UI and saves storage state to `.hardening/auth-qa.json`. |
| `sweep.mjs` | Route sweep: HTTP status, final URL (wrong destinations, redirect loops), console/page errors, 4xx-5xx responses, horizontal overflow, screenshot per route. |
| `probe.mjs` | Like `sweep`, at a chosen device size and colour scheme. |
| `hydration.mjs` | Console errors for one route (public). |
| `hydration-auth.mjs` | Hydration + console check across authenticated routes. |
| `authforms-nojs.mjs` | Submits the auth forms with JavaScript disabled and asserts no credential reaches the URL. Regression test for MB-GOD-003. |
| `api-probe.mjs` | Calls an API route from inside an authenticated page and prints status + body. |
| `crawl.mjs` | The main pass. Per route: status, landed URL, console/page errors, 4xx-5xx, horizontal overflow, a full interactive-control inventory, touch targets under 44px, unnamed controls, nested interactive elements, dead links, screenshot. |
| `journey.mjs` | Declarative journey driver (`click` / `fill` / `expect-url` / `expect-text` / `expect-no-text`). Real clicks on real controls. |
| `journeys-core.mjs` | The core product journeys: bottom-nav destinations, Muddy -> message, Muddy -> profile modal, Plans create, Safe Arrival, signed-out deep-link intent. |
| `dismiss-tours.mjs` | Dismisses the guided tours for the QA account and re-saves auth state. **Run this before any crawl** - the tours overlay twelve surfaces and an undismissed crawl audits the overlay, not the page. |
| `privacy-probe.mjs` | Product Constitution invariants: no coordinates/distances in any payload, non-Muddy data unreadable, IDOR attempts rejected. |
| `seed-proximity.mjs` | Gives the privacy probe something real to catch - four users 120-500m apart with genuine lat/lng rows. Re-run before proximity assertions: locations go stale after 15 minutes by design. |
| `nested-check.mjs` | Precise nested-interactive-element check (reports the outer element's own markup, not descendant text). |
| `find-control.mjs` | Prints the class, size and markup of any control matching a text fragment. For pinning down a crawl finding. |

## Examples

```bash
# Authenticated sweep at iPhone 14 Pro size
MSYS_NO_PATHCONV=1 node scripts/hardening/sweep.mjs \
  --auth "C:/mb-god/.hardening/auth-qa.json" \
  --routes "/dashboard,/friends,/profile,/messages,/plans,/events"

# Same surface in dark mode on a small phone
MSYS_NO_PATHCONV=1 node scripts/hardening/sweep.mjs \
  --auth "C:/mb-god/.hardening/auth-qa.json" \
  --size 360x800 --theme dark --routes "/dashboard,/profile"

# Credential-leak regression check
MSYS_NO_PATHCONV=1 node scripts/hardening/authforms-nojs.mjs
```

Output (screenshots, `report.json`, captured auth state) goes to `.hardening/`,
which is gitignored — `auth-qa.json` holds a real session token.

## Order of operations for a full pass

```bash
node scripts/hardening/seed-local.mjs        # cast
node scripts/hardening/seed-proximity.mjs    # live locations (15-min freshness)
node scripts/hardening/login.mjs             # real session
node scripts/hardening/dismiss-tours.mjs     # clear first-run overlays
node scripts/hardening/crawl.mjs   ...       # the pass itself
node scripts/hardening/journeys-core.mjs     # end-to-end behaviour
```

## Known local-only artifacts

These are environment effects, **not** product defects. Do not "fix" them.

- **Realtime CSP error.** `lib/security/csp.ts` derives the websocket origin via
  `replace(/^https:/, "wss:")`, correct for production HTTPS but unable to
  convert a local `http://` origin to `ws://`. Console shows
  `realtime CHANNEL_ERROR; using poll fallback`.
- **Slow first navigation (dev only).** The first visit to an authenticated route
  can take ~100s while Turbopack compiles it. This produced one false timeout
  classification (`/linkr`), which is why exhaustive passes run against
  production output, where the same route serves in ~2s.
- **Stale proximity.** `user_locations` rows age out after 15 minutes by design,
  and the product then correctly stops showing a proximity band. Re-run
  `seed-proximity.mjs` before asserting on proximity, and never assert on a
  specific band label - assert on the ABSENCE of measurements instead.
- **`/linkr/orb-off.png` 404.** A deliberate probe for artwork that has not
  landed yet; the component falls back to a placeholder. See MB-GOD-006.
