# Mad Buddy — God Mode Hardening Audit Ledger

**Program:** Ultimate Product Hardening (Missions 1–8 + convergence)
**Baseline SHA:** `3a42cc06e1506682595de544ca335abc3c110749` (origin/main, production)
**Worktree:** `C:\mb-god`
**Branch:** `hardening/god-mode-product-pass`
**Started:** 2026-08-22

## Operating rules for this ledger

- Every finding gets an ID, surface, route, severity, category, repro, expected,
  actual, root cause, fix, verification, and the stage it was discovered at.
- A finding is only CLOSED when it has runtime (browser) proof, not source
  inspection — except for pure backend/server invariants, which close on a test
  that fails when the behaviour is deliberately broken.
- Defects are fixed at the ROOT LAYER, not the file where they became visible.

## Severity

| Level | Meaning |
| --- | --- |
| P0 | Release blocker: security/privacy breach, data loss, app unusable, auth impossible, primary nav broken |
| P1 | Critical product defect: core action broken, wrong destination, dead primary CTA, permanent spinner, major mobile layout failure, incorrect lifecycle |
| P2 | Major UX: confusing flow, wrong hierarchy, hard-to-find core action, bad error recovery, major inconsistency |
| P3 | Polish: spacing, typography, cosmetic alignment (log + batch) |

---

## Inherited ledger entries (declared at program start)

### KNOWN-001 — App-wide hydration warning
- **Surface:** global / confirmed on `/settings`
- **Severity:** P1 (blocks "zero avoidable hydration errors" gate)
- **Status:** OPEN — to be root-caused in Mission 1 / Reliability
- **Note:** Must be traced to the shared layer producing it, not patched per page.

### KNOWN-002 — `SOCIALIZE_AREA_TIERS` retains legacy proximity vocabulary
- **Surface:** Socialize (`/discover`)
- **Severity:** P2 pending product decision
- **Status:** OPEN — requires a product decision (retain / retire / reconcile)
  BEFORE any vocabulary migration. Socialize uses these as author-side area
  selection, NOT another person's distance, so Glow V2 migration is NOT
  automatically correct.

### KNOWN-003 — `relationship-lifecycle.test.ts` exceeds 5s under parallel load
- **Surface:** test infrastructure
- **Severity:** P2
- **Status:** **CLOSED** by MB-GOD-001. The premise was incomplete in two ways:
  it was not one failing test but two, and the cause was not the test body but a
  synchronous source-tree scan starving the shared worker's event loop. Verified
  fix: **6836/6836, 335/335 files**, suite 147s -> 99s.

---

## Baseline measurements

Recorded at program start against the untouched baseline SHA, in this worktree,
against the LOCAL Supabase Docker stack (never production).

| Metric | Baseline |
| --- | --- |
| TSC | PASS (exit 0) |
| Tests | **6834 passed / 2 FAILED** (6836) — declared baseline said 6835/6836 with one known failure; the real number is two failures |
| Test files | 333 passed / 2 failed (335) |
| Suite duration | 147.24s |
| ESLint | 0 errors, **44 warnings** (all `no-unused-vars` dead code) |
| Build | (pending) |
| `git diff --check` | CLEAN |

---

## Findings

<!-- MB-GOD-NNN entries appended below as discovered. -->
### MB-GOD-001 — Synchronous source-tree scan starves the test worker (resolves KNOWN-003)

| Field | Value |
| --- | --- |
| **Surface** | Test infrastructure (`lib/life/friendship-query-guard.ts`) |
| **Route** | n/a |
| **Severity** | P2 |
| **Category** | Reliability / test infrastructure |
| **Stage** | Mission 1 — Advanced |
| **Status** | **FIXED** |

**Reproduction.** Run the full suite (`npx vitest run`) on the baseline SHA.

**Expected.** 6836/6836 pass.

**Actual (baseline).** TWO files fail, not one as previously reported:
- `lib/life/relationship-lifecycle.test.ts > soft ending > no friendship hard delete survives outside account erasure` — timed out in 5000ms
- `lib/messaging/conversation-presence.test.ts > day dividers > falls back to a short date further back` — timed out in 5000ms

The second failure was **not** in the declared baseline (which reported 6835/6836
and a single known failure). It is the key diagnostic clue: `dayLabel()` is pure
date formatting that performs no I/O whatsoever and cannot legitimately consume
five seconds. A pure function timing out means the worker's event loop was
blocked by something else.

**Root cause.** `collectFriendshipQuerySites(root)` walks `app/`, `lib/` and
`components/` — 828 files, ~5.9MB — and runs the character-by-character
`blankComments()` pass over all of it. Measured cost: **821ms cold, ~400ms warm,
on an idle machine**, entirely **synchronous**.

It was called from **five** sites across three suites:
- `relationship-lifecycle.test.ts:73` and `:306` (twice in one file)
- `friendship-query-guard.test.ts:127`
- `ended-friendship-authorization.test.ts:186` and `:211`

Each call redid the whole scan. Under full-suite parallel load, workers compete
for CPU and disk, inflating each scan past the 5s default — and because the work
blocks the event loop, it starves *unrelated* tests sharing that worker. That is
precisely how an innocent date-formatting assertion in a different feature area
came to fail on a timeout.

So the previously assumed cause ("this one test is genuinely slow") was wrong on
both counts: it was not one test, and the test bodies were not the problem.

**Fix.** Memoise the scan per root in `lib/life/friendship-query-guard.ts`. The
scan is a pure function of the source tree and the tree does not change while a
test process runs, so caching is semantically free. Added
`clearFriendshipQuerySiteCache()` for any future test that mutates the tree
in-process.

Deliberately **not** done: raising the timeout. That would have hidden the
starvation, left the suite slow, and left the innocent test still at risk — the
program brief explicitly warned against it, and the evidence confirms the warning
was correct.

**Verification.**
1. All four affected suites pass together: 110/110, total 3.50s (was: 2 failures).
   `ended-friendship-authorization.test.ts` fell from a full scan to **18ms**.
2. **Mutation test** (proving the guard is not merely faster but still correct):
   removed `.is("ended_at", null)` from `lib/friends/service.ts:502` and re-ran.
   The guard **failed as designed**, naming the exact offending site
   (`lib/friends/service.ts:502`). File restored; `git status` confirms only the
   intended change remains. A cached guard that had gone blind would have passed
   here — it did not.

**FOLLOW-UP (same finding, deeper cause).** Memoisation alone was NOT enough.
On a later full run under machine load the same test timed out again, which
disproved "one cached scan is cheap enough": the FIRST scan in a worker still
cost ~1s of blocking work against a 5s budget, so any load spike still broke it.

Profiling separated the two halves of the scan and found the real bottleneck:

```
walk  =   28ms   (828 files)
parse = 7336ms   (blankComments over ~6.0MB)
```

The directory walk was never the problem. `analyzeFile` ran the
character-by-character `blankComments()` pass over EVERY file, though only ~50
files contain the substring `friendships` at all -- so ~780 files were fully
parsed only to match nothing.

**Second fix.** A cheap substring reject at the top of `analyzeFile`: a file
whose raw text does not contain `friendships` cannot contain
`.from("friendships")`, so it returns immediately. Checked against the RAW text
deliberately -- the point is to skip work BEFORE blanking, and a false positive
(the word appearing only in prose) costs one ordinary parse that then finds
nothing. No site can be missed, since every real site contains the substring.

Measured after: **828 files -> 50 candidates, 6.0MB -> 0.86MB**, full scan
**7336ms -> 727ms (10x)**, and the guard's own repository test runs in **18ms**.

Re-verified by mutation: removing `.is("ended_at", null)` from
`lib/friends/service.ts:502` still fails the guard, naming that exact line.

**Full-suite verification (after fix).** `npx vitest run`:
`Test Files 335 passed (335)` / `Tests 6836 passed (6836)` / Duration **98.98s**.

Baseline was 6834 passed + 2 failed in 147.24s.

**Final measurement, after BOTH fixes, on a quiet machine (dev server stopped):**
`Test Files 335 passed (335)` / `Tests 6836 passed (6836)` / Duration **72.25s**.

That is 147.24s -> 72.25s, a **51% faster suite**, with both failures gone. The
starvation was costing real wall-clock time across every worker, not just the two
tests that visibly timed out.

### MB-GOD-002 - App-wide hydration warning: CSP nonce-hiding (resolves KNOWN-001)

| Field | Value |
| --- | --- |
| **Surface** | Global (root layout + landing page) |
| **Route** | Every route; originally reported on `/settings` |
| **Severity** | P1 |
| **Category** | Reliability / hydration |
| **Stage** | Mission 1 - Advanced |
| **Status** | **FIXED (runtime-verified)** |

**Reproduction.** Load any route in a real browser and watch the console.

**Expected.** No hydration warnings.

**Actual (baseline).** React: "A tree hydrated but some attributes of the server
rendered HTML didn't match the client properties." The diff named the element:

```
<script id="theme-script"
+   nonce="n2v8H_syYZIUlataOeGnbw"   (client)
-   nonce=""                          (server)
```

**Root cause.** Not an app bug - a browser behaviour the app was not accounting
for. The CSP specification requires a user agent to **empty the `nonce` content
attribute** once the document has loaded, so a stylesheet cannot use an attribute
selector to exfiltrate the nonce. Verified directly in Chromium:

```
getAttribute("nonce") -> ""                        (blanked by the browser)
element.nonce         -> "ewAxPCgmHgYOWR0U6_belw"  (real value, IDL property)
```

React hydrates AFTER that blanking and compares its `nonce` prop against the
now-empty DOM attribute, so it reports a mismatch on every page load. Because the
script lives in the ROOT layout, the warning appeared app-wide - which is why it
presented as "an app-wide hydration warning confirmed on /settings" rather than a
defect in any one page. `/settings` was a witness, not a cause.

Confirmed the app's own nonce plumbing is correct: `proxy.ts` mints a per-request
nonce, and the response CSP header and served HTML carry the SAME value
(`nonce-81oNH1m6cq-lM5cWtGhB6Q` in both).

**Fix.** `suppressHydrationWarning` on the two nonce-bearing script elements -
`app/layout.tsx` (theme bootstrap) and `app/page.tsx` (JSON-LD structured data).
Scoped to those elements only, so genuine mismatches anywhere else still surface.
Removing the nonce was not an option (it would break the enforced CSP), and the
browser's attribute-hiding cannot be disabled.

**Verification (runtime, real Chromium).**
- Before: `/` and `/signup` both logged the mismatch.
- After the layout fix alone: `/signup`, `/login`, `/about`, `/privacy`, `/faq`
  clean - while `/` STILL reported a mismatch, which correctly exposed the
  SECOND nonce'd script (JSON-LD in HomePage). Scoped suppression proved its
  worth by not masking it.
- After both fixes: `/`, `/login`, `/signup` clean.
- Authenticated routes with a real session: **`/settings` clean** (the originally
  reported surface), `/profile` clean, `/dashboard` clean.

**Note for Mission 6.** A third nonce site exists - `<GoogleAnalytics nonce={nonce}>`
in `app/layout.tsx` - which only renders in production. It is third-party, so
`suppressHydrationWarning` cannot be passed to its inner script. Flagged to
re-check against a production build before release.

### MB-GOD-003 - Password submitted in the URL query string when JavaScript does not run

| Field | Value |
| --- | --- |
| **Surface** | Authentication |
| **Route** | `/login`, `/signup` (and email on `/forgot-password`) |
| **Severity** | **P0** - credential exposure |
| **Category** | Security / privacy |
| **Stage** | Mission 1 - Advanced (found opportunistically during runtime setup) |
| **Status** | **FIXED (runtime-verified)** |

**Reproduction.** Load `/login` with JavaScript unavailable, fill the form, submit.

**Expected.** Credentials are never placed in a URL.

**Actual.** The address bar became:

```
http://localhost:3100/login?email=qa%40local.test&password=SecretPw123%21
```

`/signup` leaked identically. Confirmed in the server access log:
`GET /login?email=qa%40local.test&password=HardeningPass123%21`.

**Root cause.** All four auth forms are `onSubmit`-only (react-hook-form calling a
server action) with **no `method` and no `action`**. A form with no method
defaults to **GET**, so whenever the page's JavaScript has not run - a failed or
blocked chunk, a slow network that drops the bundle, an extension, JS disabled -
the browser performs its own submission and appends every field to the URL. A URL
like that is written to browser history, server access logs, and any intermediate
proxy or CDN.

This was found by accident: the dev server was mid-recompile, the bundle did not
load, and the harness's own login attempt leaked its password into the URL. The
condition it simulates - JS missing on a real device - is entirely realistic.

**Fix.** `method="post"` on all four auth forms (`login`, `signup`,
`reset-password`, `forgot-password`). The fields then travel in the request body.
This does NOT create a non-JS login path (there is no non-JS endpoint, so the
attempt still fails closed) - it only changes WHAT LEAKS WHEN IT FAILS.
`forgot-password` was included because an email address in a URL is unnecessary
exposure too.

**Verification (runtime).**
- JS disabled, after fix: `/login`, `/signup`, `/forgot-password` all end on a
  clean URL - no `password=`, no `email=`.
- JS enabled: login still succeeds through the SERVER ACTION, not a native form
  POST. Playwright request trace shows `POST /login | isNavigation: false`
  followed by navigation to `/friends`, confirming the normal path is unchanged.
- `npx tsc --noEmit` passes.

### MB-GOD-ENV-001 - Local Supabase stack missing DML grants (environment, not product)

| Field | Value |
| --- | --- |
| **Surface** | Local development environment |
| **Severity** | n/a (blocks runtime verification; **not** a product defect) |
| **Status** | **REPAIRED** |

Every RLS-scoped read failed locally with `permission denied for table X`
(Postgres 42501). In the browser this surfaced as `GET /api/notifications` -> 500
on every authenticated page.

**Investigation.** The first hypothesis - local drift from an earlier session -
was WRONG, and a clean `npx supabase db reset` disproved it: replaying all 104
migrations onto a fresh database reproduced the gap exactly (still only **1** of
171 tables granting SELECT to `authenticated`, and that one only because its
migration grants explicitly).

The real cause is the local stack's default ACL for `postgres`-owned tables in
`public`:

```
anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
```

`Dxtm` is TRUNCATE/REFERENCES/TRIGGER/MAINTAIN - **no** SELECT/INSERT/UPDATE/DELETE.
The container runs **Postgres 17.6** while `supabase/config.toml` declares
`major_version = 15`; that mismatch is what produces the different default ACL.

**Why this is not a production defect.** `service_role` is missing DML here too,
yet the app's service-role queries work - and hosted Supabase supplies these
grants from its own platform default privileges, which is what the migrations
correctly rely on. The repo intentionally grants no table privileges: RLS
policies, not grants, are what narrow access per user.

**Repair.** `scripts/hardening/local-db-grants.sql` - grants only, no policy,
schema or data change, documented as local-only. Verified: 171/171 tables now
grant SELECT to `authenticated`, and `/api/notifications` returns **200**.

Test fixture rebuilt as `scripts/hardening/seed-local.mjs` (5 users, 2
friendships, one deliberately sparse profile to exercise empty states). Users are
created via `admin.createUser({ email_confirm: true })`, never `auth.signUp`.

**Harness caveat (not a defect).** Locally the CSP blocks the Supabase Realtime
socket, because `lib/security/csp.ts` derives the websocket origin with
`supabase.replace(/^https:/, "wss:")` - correct for production HTTPS, but it
cannot convert a local `http://` origin to `ws://`. Console shows
`realtime CHANNEL_ERROR; using poll fallback`. Production is unaffected.
