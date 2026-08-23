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

## Accepted findings — Mission 1 Advanced (owner-approved 2026-08-22)

The three findings below were reviewed and **accepted**. They are recorded here in
summary; full reproduction, root cause and verification detail follow in the
Findings section.

| ID | Severity | Summary | Status |
| --- | --- | --- | --- |
| MB-GOD-001 | P2 | Test-infrastructure event-loop starvation from repeated synchronous source-tree parsing. Fixed at source. Full suite **147s -> 72s**. | FIXED |
| MB-GOD-002 | P1 | App-wide nonce hydration warning caused by browser nonce blanking required by CSP semantics. Root-layout handling corrected **without** hiding unrelated hydration warnings. | FIXED |
| MB-GOD-003 | **P0** | **Credential leak.** Auth forms had no explicit `method` and could natively submit as **GET** before hydration, placing email/password in the URL. Fixed across all affected auth forms. | FIXED |

**MB-GOD-003 remains a P0 discovered-and-fixed item in the final report.** It is
not downgraded on account of being fixed: the severity records what the defect
was, not what it is now.

## Open / unclassified

### MB-GOD-004 - `/linkr` did not respond within 240s

| Field | Value |
| --- | --- |
| **Surface** | Linkr |
| **Route** | `/linkr` |
| **Severity** | n/a |
| **Status** | **CLASSIFIED: DEV TOOLING / TURBOPACK COLD-COMPILE ARTIFACT - closed** |

**Resolution.** Tested against production output (`next build` + `next start`,
port 3200) with a real authenticated session:

```
200   2567ms   14 controls   /linkr
```

The route loads normally and well within budget, so the earlier 240s event was a
dev-mode cold-compile artifact under concurrent load, not a product defect. It
was NOT waived on assumption -- it was retested on the faster, more
representative target before being closed.

For contrast, the same production server serves the public routes in **35-500ms**
where dev took ~100s per cold route. That gap is why the remaining exhaustive
passes run against built output.

During the Mission 1 Advanced authenticated sweep, `/linkr` failed to reach
`domcontentloaded` within 240s while the dev server was under concurrent load.
Every other route in that sweep returned 200.

**This is deliberately NOT yet called an environment artifact.** The classification
rule for it:

- If production output loads `/linkr` normally ->
  **DEV TOOLING / TURBOPACK COLD-COMPILE ARTIFACT**, closed.
- If production output also hangs or materially underperforms ->
  **real product/performance defect**, root-caused before the program continues.
  Inspection list: server query stalls, N+1 queries, recursive projection,
  excessive data loading, client bundle size, suspense/deadlock, network timeout,
  auth loop.

It is not waived either way.

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

### MB-GOD-ENV-001 - Local Supabase stack missing DML grants

| Field | Value |
| --- | --- |
| **Classification** | **ENVIRONMENT / LOCAL TOOLCHAIN** |
| **Surface** | Local development environment |
| **Severity** | n/a - blocks runtime verification; **not** a product defect |
| **Status** | **REPAIRED LOCALLY (environment limitation remains visible)** |

**Standing instruction (owner decision).** Do NOT patch the production schema on
the strength of this local mismatch, and do NOT add blanket `GRANT` migrations
merely to force local parity. The limitation stays recorded here rather than
being engineered away.

Evidence summary:
- local Postgres = **17.6**
- `supabase/config.toml` declares = **15**
- production Supabase platform defaults supply the expected grants

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
### MB-GOD-005 - Primary tab rows and CTAs below the 44px minimum touch target

| Field | Value |
| --- | --- |
| **Surface** | Muddies, UpFor, Events, Plans (cross-surface) |
| **Route** | `/friends`, `/hangout-mode`, `/events`, `/plans` |
| **Severity** | P2 |
| **Category** | Mobile ergonomics / design-system consistency |
| **Stage** | Mission 1 - Advanced (production runtime crawl) |
| **Status** | **FIXED (runtime-verified)** |

**Reproduction.** Crawl the authenticated surfaces at 393x852 and measure every
visible control's bounding box.

**Expected.** No interactive control below 44x44, the minimum the codebase
already uses elsewhere.

**Actual.** Every primary tab row in the product sat under the minimum, at three
different heights - evidence of three independent implementations rather than one
shared component:

| Surface | Control | Measured |
| --- | --- | --- |
| Muddies | All / Circles / Close Friends / Requests / Blocked | 41px |
| Muddies | "Message" (primary action on every Muddy card) | 40px |
| UpFor | For You / Muddies / Around / Groups | 36px |
| UpFor | "Start an UpFor" (the empty state's only action) | 38px |
| UpFor | "Your exact location is never shared" (link to /safety-center) | 18px |
| Events | Home / Discover / Yours / Hosting | 36px |
| Plans | Upcoming / Invitations / Created by you / No date yet / Past | 42px |

**Root cause.** Not a missing standard - the 44px convention already exists and
is honoured in 11 components and many CSS rules (`min-h-11`, the dropdown rows,
the camera controls, the quick-action column). The tab rows simply never adopted
it: `.muddies-filter` and `.muddies-card-action` declared **no** `min-height` at
all and inherited their size from padding, while `.upfor-tab` (2.25rem),
`.upfor-empty__cta` (2.4rem) and the Events tabs (`min-h-[2.25rem]`) each picked
their own smaller value. This is design-debt drift, and it is why the same defect
appears on four surfaces at three different sizes.

Notably these are not incidental controls: they are the primary filter
navigation of four major surfaces, the main action on every Muddy card, and the
single CTA a brand-new user meets in the UpFor empty state.

**Fix.** Adopt the existing convention rather than inventing a new one - 44px
(`min-h-11` / `2.75rem`) on each. The safety link took `padding-block` instead of
`min-height`, because it is a centred line of text where a min-height would not
enlarge the tappable area around the words.

Files: `app/globals.css` (`.muddies-filter`, `.muddies-card-action`,
`.upfor-tab`, `.upfor-empty__cta`, `.upfor-safety`),
`components/events/events-page.tsx`, `components/plans/plans-page.tsx`.

**Verification (production runtime, 393x852).**

```
before:  /friends small-target:8   /hangout-mode 6   /events 4   /plans 5
after:   /friends clean            /hangout-mode 0   /events clean  /plans clean
```

**Detector correction.** The first crawl also reported a nested interactive
element on Muddies and several 1x1 controls. Both were **false positives in my
own harness**, not product defects:
- the nesting check tested every node matching a broad selector (including
  `[tabindex]` wrappers), so an ordinary `div` CONTAINING a button was reported.
  A precise re-check found **0** genuine nestings across nine surfaces.
- the 1x1 controls are the visually-hidden "Skip to content" link and hidden
  file inputs, which are correct accessibility affordances.

`crawl.mjs` was corrected for both so later passes are not misled.

### MB-GOD-006 - Linkr orb assets 404 on every load (documented, not a regression)

| Field | Value |
| --- | --- |
| **Surface** | Linkr |
| **Route** | `/linkr` |
| **Severity** | P3 |
| **Category** | Console noise / missing asset dependency |
| **Stage** | Mission 1 - Advanced |
| **Status** | OPEN - deliberately not "fixed" |

`GET /linkr/orb-off.png` returns **404** on every `/linkr` load, producing a
console error each time.

This is **not** a regression and not an accident. `components/linkr/linkr-orb.tsx`
probes for the artwork with an `Image()` and falls back to a branded placeholder,
reserving the same box either way so the real art cannot shift the layout. There
is an explicit test (`lib/visuals/registry.test.ts`) asserting the three orb
assets are absent, so their absence is a tracked missing dependency:

```
FINAL LINKR ACTIVATION ASSET REQUIRED  -> /public/linkr/orb-off.png
FINAL LINKR CONNECTION ASSET REQUIRED  -> /public/linkr/orb-activate.png
FINAL LINKR EMPTY-STATE ASSET REQUIRED -> /public/linkr/orb-empty.png
```

Left as-is because the probe IS the mechanism - the `onerror` handler is how the
component detects absence, and dropping a file at those paths switches it over
with no code change. Substituting placeholder art to silence the 404 is exactly
the failure the component's own documentation warns about ("gets shipped, and
then never gets replaced because it is already done").

**Carried forward:** the console error is real noise that will mask genuine
errors in production logs. Revisit in Mission 6 (error hygiene) - either the art
lands, or the probe moves to a method that fails quietly.

### MB-GOD-007 - UpFor is served from the legacy route `/hangout-mode`

| Field | Value |
| --- | --- |
| **Surface** | UpFor |
| **Route** | `/hangout-mode` |
| **Severity** | P2 |
| **Category** | Information architecture / legacy vocabulary |
| **Stage** | Mission 1 - Advanced (route inventory) |
| **Status** | OPEN - deferred to Mission 4 |

The bottom navigation labels the tab **UpFor**, and every product surface calls
the concept UpFor, but the route is `/hangout-mode` - an older name for the
feature. A user who shares the URL, bookmarks it, or simply reads the address bar
meets engineering history the product otherwise never mentions.

The program's standard is explicit that a user "should not encounter legacy
vocabulary". Deferred rather than fixed here because renaming a route touches
deep links, notification destinations, invite links and any shared URL already in
circulation, so it belongs with the Mission 4 information-architecture pass where
the redirect strategy can be decided as a whole.

## Privacy verification (Mission 6, early evidence)

Run against production output with a real authenticated session
(`scripts/hardening/privacy-probe.mjs`).

**The first run was a WEAK PASS and is recorded as such.** `/api/friends/nearby`
returned `{"friends":[]}` - the fixture had no location data, so "no coordinates
leaked" was true only because there was nothing to leak. A privacy test that
cannot fail proves nothing.

`scripts/hardening/seed-proximity.mjs` was added to give the test something real
to catch: four users placed 120m-500m apart in Accra, with genuine latitude,
longitude and accuracy rows in `public.user_locations`.

**Re-run with real coordinates present - meaningful pass:**

```json
{ "friend_id": "...", "display_name": "Kofi Mensah", "username": "kofim",
  "proximity_level": "close", "proximity_band": "around_you",
  "glow_strength": 95, "status_text": "Close and glowing clearly",
  "confidence": "high" }
```

- No `latitude`, `longitude`, `distance_m`, `metres`, `km` or `accuracy` in any
  client payload, nor in the rendered `/friends` HTML.
- Only **bands** are exposed (`close` / `around_you`), never a measurement.
- `saao`, who has a location row but no relationship to the signed-in user, is
  correctly **absent** - proximity is scoped to approved Muddies.
- `glow_strength` was checked specifically as a possible distance proxy. It is
  not: `glowStrengthForLevel` derives it from the BAND alone (close=90, near=64,
  far=34) and adds +/-5 random jitter, so it carries no distance information and
  cannot be correlated across polls.
- IDOR attempts against another user's id return **404**.

### MB-GOD-008 - Guided tour overlays every major surface on first visit

| Field | Value |
| --- | --- |
| **Surface** | Muddies, Home, Messages, Plans, Events, Linkr, UpFor, Profile, Settings, Notifications, Circles, Safe Arrival |
| **Severity** | P3 (behaviour is intentional; recorded for Mission 3 review) |
| **Category** | Onboarding / first-run experience |
| **Stage** | Mission 1 - Advanced |
| **Status** | OPEN - deferred to Mission 3 (flow) |

Discovered because it broke an automated journey: clicking "Message" on
`/friends` appeared to do nothing. The control was fine - a **"Muddies guide"
tour dialog was open on top of it**, and the click landed on the overlay.

Every one of the twelve surfaces above presents its own tour on first visit. That
is a deliberate feature (`TourHost`, `recordTourStepEventAction`), not a defect,
and each is individually dismissible with "Not now".

Recorded because the CUMULATIVE effect is a Mission 3 question, not a Mission 1
one: a brand-new user meeting a modal on twelve consecutive screens is a very
different experience from meeting one on the two screens that genuinely need
explaining. To be judged in the first-10-minutes simulation rather than fixed
blind here.

**Harness consequence** (worth stating, since it affects every later pass): an
automated crawl that does not dismiss these is auditing the overlay rather than
the page beneath it. `scripts/hardening/dismiss-tours.mjs` clears them for the QA
account and re-saves auth state. Dismissing them immediately revealed real
findings that had been hidden - including the Messages filter row's touch-target
defect below.

### MB-GOD-005 (extended) - the touch-target defect was wider than first measured

The first pass fixed four tab rows. Dismissing the tour overlays and re-crawling
exposed more of the same pattern, and the total is worth stating plainly because
it is the clearest evidence of design-system drift found so far.

**Every instance fixed, by surface:**

| Surface | Control | Before | After |
| --- | --- | --- | --- |
| Muddies | 5 filter tabs | 41px | 44px |
| Muddies | "Message" on each card | 40px | **149x44 (verified)** |
| UpFor | 4 filter tabs | 36px | 44px |
| UpFor | "Start an UpFor" (empty state) | 38px | 44px |
| UpFor | safety link to /safety-center | 18px | 44px |
| Events | 4 surface tabs | 36px | 44px |
| Plans | 5 bucket tabs | 42px | 44px |
| **Messages** | **4 filter tabs** | **34px** | **44px** |
| **Notifications** | **5 filter tabs** | **34px** | **44px** |
| Home | "Wave" secondary action | 43x32 | 44px |
| Profile | avatar edit button | 40x40 | 44x44 |
| Profile | visibility pill -> glow settings | 34px | 44px |
| Profile | 3 completion rows | 42px | 44px |
| Profile | "Add"/"Edit" interests | 23x16 | 44x44 |
| Profile / Buddy Score | "View progress" / "View all" links | 16-20px | 44px |
| Journey | "View My Progress", "Continue" | 20px / 36px | 44px |
| Journey | "Replay guide" | 28px | 44px |
| **Linkr** | **back button** | **36px** | **44px** |
| Linkr | "How Linkr works" | 20px | 44px |

**Nine** distinct filter/tab rows across the product, at **four** different
heights (34, 36, 41, 42) - four independent implementations of the same
component, none of which adopted the 44px convention the codebase already used
elsewhere. The Messages and Notifications rows share a byte-identical class
string, so the pattern was copied between surfaces and the defect with it.

The Linkr **back button** deserves separate mention: a user who cannot reliably
hit Back is stuck, which makes it the last control in the product that should
have been under the minimum.

**Deliberately NOT changed.** "Create a Plan" on Home sits inside the sentence
"Create a Plan with your Muddies." It is a genuine inline prose link; giving it a
44px box would break the line it lives in. Inline links in running text are the
documented exception to the touch-target rule, and treating them otherwise would
damage the reading experience to satisfy a number.

## Journey verification (Mission 1 mutation/navigation audit)

Ten core journeys driven through REAL controls in a real browser against
production output - not fetch() calls, because a server action existing does not
prove a button reaches it (`scripts/hardening/journeys-core.mjs`).

```
PASS  bottom nav — Muddies          PASS  Plans -> create
PASS  bottom nav — Messages         PASS  Profile from Settings
PASS  bottom nav — Linkr            PASS  Safe Arrival reachable
PASS  bottom nav — UpFor            PASS  deep link preserves intent
PASS  Muddy -> message              PASS  Muddy -> profile modal
10/10
```

Notable: **"Muddy -> profile modal" initially FAILED and the product was right.**
The journey asserted a URL change; tapping a Muddy actually opens a profile
**modal**, which is the better interaction - it keeps the list underneath and
offers Wave / Ping / Message inline. The assertion was corrected, not the app.
The modal was then verified to show the correct person (`@kofim`), the correct
relationship state ("Approved Muddy"), a privacy-safe proximity band ("Just
Around", never a distance), and a working route through to `/friends/kofim`.

This is the distinction the program asks for: a failing check is a question, not
a verdict.
## MISSION 5 — Global mobile shell, safe area, notch (Advanced)

### MB-GOD-009 - Safe-area architecture: NO root-cause defect found

| Field | Value |
| --- | --- |
| **Surface** | Global shell, 12 authenticated surfaces |
| **Severity** | n/a - **negative finding, recorded deliberately** |
| **Category** | Mobile geometry |
| **Stage** | Mission 5 - Advanced |
| **Status** | **VERIFIED SOUND** |

The brief states the notch/status-bar problem has recurred across development
and asks for the root cause rather than another per-screen patch, treating
repeated unsafe-area defects as evidence of a global architecture problem.

**Audited, and the architecture is not the problem.** Recording this as a
finding because "we looked hard and it is sound" is a result, and because the
next person to meet a notch bug should not re-open this ground blindly.

**What was verified.**

1. **One canonical token set exists and is documented**, in `app/globals.css`:
   ```css
   --app-header-content-height: 4.25rem;                 /* the row itself */
   --app-header-height: calc(env(safe-area-inset-top, 0px) + var(--app-header-content-height));
   --mobile-nav-height: 5rem;                            /* bar, excluding inset */
   --mobile-header-height: calc(env(safe-area-inset-top, 0px) + var(--mobile-header-content-height));
   ```
   The comments already say these are the single source of truth, that a page's
   sticky control must offset from `--app-header-height` rather than `top: 0`,
   and that `--mobile-nav-height` was corrected from 4.5rem after it left the
   last section 1px occluded. This is a system somebody thought about.

2. **Zero hard-coded notch guesses in the entire source.** Searched for
   `padding-top: 44px|52px`, `padding-bottom: 34px`, `top: 44px|47px|59px` -
   the scattered magic numbers the brief warns about. **None.**

3. **Every pinned element derives its geometry from the tokens.** Across the 12
   surfaces, each `<header>` and the bottom `<nav>` traces back to
   `env(safe-area-inset-*)` or a token built from it: **0 elements** with
   hard-coded edge geometry.

4. **Content reserves the chrome's footprint.** `<main>` carries
   `padding-top: 68px` against a 69px header and `padding-bottom: 100-160px`
   against a 75px bottom bar, on every surface.

5. **The immersive surfaces are correct too, by a different route.** `/linkr`
   and `/hangout-mode` are in `IMMERSIVE_HEADER_PAGES`, so the shell adds no
   offset and the page clears the header itself -
   `.upfor-page { padding-top: calc(env(safe-area-inset-top, 0px) + 4.75rem) }`.
   Verified directly in the browser: header bottom **76px**, first content
   section top **76px**. Exact.

6. **No horizontal overflow at any tested width** - 360x800, 375x812, 390x844,
   393x852, 430x932 - in both light and dark.

**Two harness errors worth recording, because both produced convincing false
alarms and either could have sent this program off chasing a phantom:**

- `env(safe-area-inset-*)` resolves to **0** in headless Chromium and cannot be
  overridden from script or a stylesheet - it is a user-agent value, not a
  custom property. A first attempt injected `--safe-top`/`--safe-bottom` and
  painted markers at 59/34px, then reported every fixed header and every
  bottom-nav tab as intruding. All false: the app resolved `env()` to 0 while
  the markers drew at 59/34, so they disagreed by construction. **Simulating a
  notch that way measures the simulation, not the app.**
- A second attempt compared `<main>`'s top edge against the header height and
  flagged all twelve surfaces. Also false: `<main>` deliberately starts at y=0
  and reserves the header with `padding-top`, so content scrolls beneath a
  translucent header while still beginning below it.

The audit now checks the property that actually decides correctness on a real
device: **whether the geometry is DERIVED from the insets**. A header sized
`calc(env(safe-area-inset-top) + <content>)` is correct at every inset value,
including the 0 a desktop browser reports; a header sized `44px` is wrong on
every device whose inset differs, and no amount of screenshotting at inset 0
would reveal it.

**Residual, honestly stated.** `scripts/hardening/safe-area.mjs` still prints
`CONTENT-UNDER-HEADER` for `/hangout-mode`. That is a **detector limitation, not
a defect**: the padded element is `.upfor-page`, which contains the fixed header
as its own first child, so a generic "first child's top" reading returns 0. The
surface was checked by hand and is correct (76 = 76). Left visible rather than
over-fitted away, so the flag keeps its meaning on other surfaces.

**What this means for the recurring bug.** The tokens are right, so a future
notch defect is far more likely to be a NEW surface that does not consume them
than a flaw in the system. `scripts/hardening/safe-area.mjs` is the regression
check: it fails the moment a pinned element appears whose geometry is not
derived from the tokens.

**Not yet covered** (deferred to Mission 5 Extremely Advanced): keyboard-open
composer behaviour, landscape, installed-PWA/Capacitor standalone chrome, and
safe-area correctness INSIDE sheets, modals, the photo viewer and the camera.
## MISSION 1 — Advanced (continued): pre-hydration / native-submit form audit

### MB-GOD-010 - Admin credentials submitted in the URL when JavaScript does not run

| Field | Value |
| --- | --- |
| **Surface** | Admin authentication |
| **Route** | `/admin/login`, plus `/admin` create-admin form |
| **Severity** | **P0** - credential exposure (privileged account) |
| **Category** | Security / privacy |
| **Mission / Level** | Mission 1 - Advanced |
| **Status** | **FIXED (runtime-verified)** |

**Reproduction.** Load `/admin/login` with JavaScript unavailable, fill it, submit.

**Expected.** Credentials never appear in a URL.

**Actual (verified in a real browser before the fix):**

```
form method: null
final URL:   /admin/login?email=admin%40local.test&password=AdminSecret123%21
```

**Root cause.** Exactly the MB-GOD-003 defect class, in a surface the first fix
did not reach. That fix was scoped to `components/auth/` - the four consumer auth
forms - rather than to the SHAPE of the defect. `components/admin/` builds its
forms the same way (react-hook-form `onSubmit`, no `method`, no `action`), so it
had the identical hole the whole time, on a form that grants staff access.

This is the more important lesson of the two: the first fix addressed the
instances it had seen instead of the class, and a second P0 was sitting one
directory away.

**Scope found.** A static sweep for the shape (`onSubmit` present, `method` and
`action` both absent) found **8** forms:

| File | What it does |
| --- | --- |
| `components/admin/admin-login-form.tsx` | **admin email + password** |
| `components/admin/create-admin-form.tsx` | **new admin email + temporary password** |
| `components/friends/friends-page.tsx` | Muddy search by username |
| `components/messages/messages-page.tsx` | conversation search |
| `components/messaging/message-composer.tsx` | message composer |
| `components/notifications/notifications-page.tsx` | notification action form |
| `components/plans/plans-page.tsx` | plan sub-form |
| `components/scan/scan-page.tsx` | QR / code entry |

**Fix.** `method="post"` on all eight. The six non-credential forms carry no
secrets, but the shape is the defect and there is no reason to leave it - a
search term in the URL is still a privacy leak into history and access logs, and
the next person to add a password field to one of these would inherit the hole.

**Verification (runtime, production build).**
- JS disabled, after fix: `form method: post`, final URL `/admin/login` clean, no
  `password=`, no `email=`.
- JS enabled: the server action still handles it - request trace shows
  `POST /admin/login nav=false` (a server action, not a native form navigation),
  no leak, and a wrong password still shows the user an error.
- Static sweep now reports **none - every onSubmit form declares method or action**.

### MB-GOD-011 - Permanent guard against the native-GET form defect

| Field | Value |
| --- | --- |
| **Category** | Test infrastructure / architectural invariant |
| **Mission / Level** | Mission 1 - Advanced |
| **Status** | **ADDED** |

Two P0s of the same shape shipped (MB-GOD-003, MB-GOD-010), the second because
the first was fixed instance-by-instance. Careful review demonstrably does not
catch this: it is invisible to any test that runs JavaScript, and the JSX looks
completely correct.

`lib/security/form-method-guard.ts` + `.test.ts` scan `app/` and `components/`
and fail on any `<form>` with an `onSubmit` handler but neither `method` nor
`action`. Nine tests: six unit (including a multi-line opening tag whose
`onSubmit` arrow contains `=>`, which a naive scan ends the tag on), and three
repository-wide - one asserting the scanner finds forms at all, so the others
cannot pass vacuously, and one naming the six credential forms explicitly so a
refactor cannot quietly drop one out of the scanned set.

**Mutation-tested, as the brief requires.** Removing `method="post"` from
`components/admin/admin-login-form.tsx` fails **two** assertions, naming the
exact file and line:

```
× no form submits as GET when JavaScript has not run
    + "components/admin/admin-login-form.tsx:65"
× every credential form posts
    → components/admin/admin-login-form.tsx:65 does not post
```

File restored; guard green. It catches the regression rather than merely
describing it.

**One self-inflicted lesson, recorded because it nearly shipped.** The first
version of the scanner reported `components/auth/login-form.tsx:98` - which is
inside the **comment** explaining the MB-GOD-003 fix, quoting the very tag it
searches for. Comments are now blanked length-preservingly (line numbers stay
valid) before matching, the same technique `lib/life/friendship-query-guard.ts`
uses for the same reason. A scanner that reports its own documentation is one
nobody trusts, and worse, it teaches the next person to ignore it.

### INVESTIGATED / NOT A DEFECT - "password" in `/forgot-password` URLs

The runtime sweep initially reported `/forgot-password` and `/reset-password` as
leaking "password". False positive: the word is the **route's own name**, in the
path, not a query parameter. The detector now inspects only the query string.
Recorded so a later session does not rediscover it.
## MISSION 1 — Extremely Advanced: state-transition sequences

Sequences driven through a real browser against production output, with row
counts read directly from Postgres where "no duplicate was created" is the claim
— a duplicate the list happens not to render is still a duplicate.

```
PASS  rapid create: double-tap must not create two Plans   — 1 plan created
PASS  navigating away mid-mutation leaves no stuck state   — clean on return
PASS  two tabs do not disagree about Muddy count           — A=2, B=2
```

**Two of the five checks did NOT actually test anything and are recorded as
inconclusive rather than as passes:**

- `request -> cancel -> resend` — the endpoint returned **400** for the payload
  the probe sent, so no request was ever created and the row counts came back
  `undefined`. The harness reported PASS because nothing failed; that is exactly
  the empty-fixture trap this program has already been caught by once. The
  lifecycle is covered by unit tests (`lib/life/relationship-lifecycle.test.ts`),
  but the end-to-end sequence remains **UNTESTED** and is carried forward.

  **CLOSED in session 5 (MB-GOD-017): 7/7 passing.** Correction to the note
  below — the 400 was **not** an anti-enumeration guard. It was a harness bug:
  the probe sent `recipientId` where the endpoint takes `targetUserId`, and
  queried `recipient_id` where the column is `receiver_id`. The plausible
  explanation recorded at the time was wrong, which is its own lesson: an
  inconclusive result must be chased down, not explained away.
- `deleted resource returns 404` — reported PASS on page text, which led to
  MB-GOD-012 below. The assertion was too weak to be evidence either way.

### MB-GOD-012 - `notFound()` inside the authenticated group responds HTTP 200

| Field | Value |
| --- | --- |
| **Surface** | Any `(app)` route that calls `notFound()` |
| **Route** | `/friends/<missing>`, `/groups/<missing>` |
| **Severity** | P2 |
| **Category** | Correctness / SEO / observability |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **OPEN — framework constraint, not an app defect** |

**Reproduction.** Open `/friends/definitelynotarealusername` with a session.

**Actual.** The correct 404 screen renders — branded, with recovery actions and
an on-brand privacy line ("Even we don't know where it is, and we don't track
locations"). But the response status is **200**.

```
200  shows404page=true   /friends/nosuchuser                    (inside (app))
200  shows404page=true   /groups/<missing uuid>                 (inside (app))
404  shows404page=true   /totally-not-a-route                   (routing miss)
404  shows404page=true   /plans/<missing uuid>                  (outside (app))
```

**Why it matters.** A 404 served as 200 is indexed by crawlers, invisible to
uptime monitoring, and cacheable as though it were real content.

**Root cause.** Not the page code — `app/(app)/friends/[username]/page.tsx`
calls `notFound()` correctly, and also uses it to hide blocked users, which is
good privacy design. The difference is WHEN the call happens. `/totally-not-a-route`
fails during routing, before anything renders, so the status is still settable.
`/friends/<missing>` renders the `(app)` layout first — which is `force-dynamic`
and streams (`Transfer-Encoding: chunked`, no `content-length`) — and reaches
`notFound()` only after the response has begun. The status cannot be changed
once headers are away.

**Attempted and reverted:** adding `app/(app)/not-found.tsx` as a group-level
boundary. It did not change the status; the response has already committed by
then. Reverted rather than left in as a fix that does not fix anything.

**Carried forward, not waived.** A real remedy exists but is an architectural
change, not a patch: resolve the resource's existence in the layout or in the
proxy — before the stream opens — so a miss becomes a routing-level 404. That
touches every dynamic detail route and belongs with Mission 4's information-
architecture pass, where the route/authorization boundaries are being decided
anyway. Recorded here with the evidence so that decision is informed.

### INVESTIGATED / NOT A DEFECT - `/events/<missing>` renders instead of 404

`/events/<uuid>` returns 200 with an "Opening Event…" screen for an event that
does not exist, rather than a 404.

**This is correct and deliberate.** The route is a share/redirect page that must
reveal nothing about whether an event exists: `robots: { index: false }`, a
generic fallback title for anyone not permitted to see the real one, and a
client redirect to `/events?event=<id>` where server-side authorization actually
decides. Returning 404 for a missing event would leak existence to anyone probing
IDs — a privacy regression dressed up as a correctness fix.

It also degrades well: `EventShareRedirect` renders a real "Open Event" link, so
the handoff still works when JavaScript does not run.

Same reasoning applies to `/invite/<bad token>`.

### INVESTIGATED / NOT A DEFECT - double-tapping "Create" on Plans

Tapping the create control twice as fast as the browser allows produced exactly
**one** Plan (verified by row count in Postgres, before 0 / after 1). No
duplicate-submission defect on this path.
## MISSION 2 / 4 — Profile information architecture

### MB-GOD-013 - Profile is an account dashboard with profile information attached

| Field | Value |
| --- | --- |
| **Surface** | Profile |
| **Route** | `/profile` |
| **Severity** | P2 |
| **Category** | Information architecture / visual hierarchy |
| **Mission / Level** | Mission 2 Advanced / Mission 4 Advanced |
| **Status** | **OPEN — audited, restructuring plan below, not yet implemented** |

The brief names Profile as a known IA concern and asks for a specific test:
strip the labels, and does the composition read as *a person's profile* or as
*an account/settings dashboard*? Measured at runtime rather than judged by
reading the JSX.

**Measured.** `/profile` is **3.97 screens tall (3382px)** at 393x852, in this
order:

```
Me → MY SHOWCASE → COMPLETE YOUR PROFILE → INTERESTS → JOURNEY →
PROGRESS → ACTIVITY → ABOUT → PRIVACY → PREFERENCES → SUPPORT
```

**Vertical space, by section:**

| Section | px | share |
| --- | ---: | ---: |
| Me (identity hero) | 672 | 19.9% |
| MY SHOWCASE | 124 | **3.7%** |
| COMPLETE YOUR PROFILE | 300 | 8.9% |
| INTERESTS (incl. Journey + Progress) | 858 | 25.4% |
| ACTIVITY | 252 | 7.5% |
| ABOUT (bio, mood) | 187 | 5.5% |
| PRIVACY | 118 | 3.5% |
| PREFERENCES | 256 | 7.6% |
| SUPPORT | 594 | **17.6%** |

**Verdict: it reads as an account dashboard.** Roughly **29%** of the page is
identity (hero, showcase, about, interests content); roughly **58%** is
settings, support, progress metrics and completion nudges.

Three specifics make the point sharper than the totals:

1. **The Showcase gets 3.7%.** The photos that most define a person's profile
   occupy less space than SUPPORT (17.6%) — five times less than links to help
   articles and feedback.
2. **ABOUT sits at y=2227**, below two full screens of metrics. The bio and mood
   — the fields that actually say who this person is — are the eighth thing on
   the page.
3. **PRIVACY, PREFERENCES and SUPPORT total 968px (28.6%)** of a surface whose
   job is identity. `Account`, `Appearance`, `Help & Support`, `Send Feedback`
   are Settings, sitting on Profile.

**Why this happened, and why it is not a criticism of the rebuild.** The Profile
rebuild made every capability *available*, which was the goal at the time and is
genuine progress — nothing here is missing or broken. But availability is not
architecture: the sections accumulated in the order they were built, so the page
is a truthful list of everything Profile's data layer owns rather than a designed
answer to "who am I here?".

**Proposed restructuring** (classification per the brief; nothing is deleted,
only relocated):

| Section | Verdict | Where it belongs |
| --- | --- | --- |
| Identity hero (avatar, name, @handle, visibility) | **KEEP PRIMARY** | Profile |
| MY SHOWCASE | **KEEP PRIMARY — promote** | Profile, directly under the hero; this is the surface's substance |
| ABOUT (bio, mood) | **KEEP PRIMARY — promote** | Profile, adjacent to identity, not below the metrics |
| INTERESTS | KEEP SECONDARY | Profile, after Showcase/About |
| COMPLETE YOUR PROFILE | **CONTEXTUAL ONLY** | Show only while incomplete; it is onboarding scaffolding, not a permanent fixture of one's identity |
| ACTIVITY (2 Muddies, 0 Plans, 0 Safe Arrivals) | KEEP SECONDARY, compact | Profile, as a single row rather than three cards |
| JOURNEY + PROGRESS (Buddy Score, achievements) | **MOVE** | `/buddy-score`, which already exists and already owns this. Leave one entry point on Profile |
| PRIVACY (Ghost Mode) | **MOVE TO PRIVACY** | `/settings/privacy` / `/settings/glow-visibility`, already the canonical home. Keep the hero's visibility pill as the contextual read-out |
| PREFERENCES (Account, Appearance) | **MOVE TO SETTINGS** | `/settings`, which owns exactly these |
| SUPPORT (Help, Feedback) | **MOVE TO SETTINGS** | `/settings`; help is not identity |

Expected shape afterwards: identity, showcase, about, interests, a compact
activity row, and one link each to Progress and Settings — roughly **1.5-2
screens** instead of 4, with the person's actual identity above the fold.

**Not implemented in this pass, deliberately.** This is a structural change to a
surface that was recently rebuilt, and the brief is explicit that a prettier
screen with worse hierarchy is a regression. It needs the before/after runtime
proof the brief asks for (current job → problem → proposed hierarchy → why →
implementation → runtime proof), and it should land together with the Settings-
side receiving work so no capability is homeless in between. Sequenced for
Mission 4, with this audit as its evidence.

**One thing the audit vindicated.** The identity hero itself is good: avatar,
name, `@handle`, and a visibility pill that reads "Visible to approved friends"
and links to the glow settings. That is the right information, in the right
place, in the right words — the problem is what was piled underneath it.
### MB-GOD-014 - Home information architecture: GOOD (contrast case)

| Field | Value |
| --- | --- |
| **Surface** | Home |
| **Route** | `/dashboard` |
| **Severity** | n/a - **negative finding** |
| **Mission / Level** | Mission 2 Advanced / Mission 4 Advanced |
| **Status** | **VERIFIED GOOD** |

Measured the same way as Profile, at 393x852, tours dismissed:

```
/dashboard  —  1.00 screens tall (852px)

  Home
  Good morning, QA
  Refresh your Glow — "Glow needs an updated location before it can show who's around."
    → Ama Boateng · Refresh Glow · Say hi
```

**This is what the brief asks Home to be**, and it is worth recording as a
contrast because it proves the Profile problem is not a house style — the team
can clearly build an adaptive surface, and did.

- **Exactly one screen.** No scrolling to find the point.
- **Adaptive, not a directory.** It is not showing a menu of every feature; it
  showed the one thing that mattered for this account's actual state — a stale
  location blocking the Glow — and the nearest Muddy.
- **The primary state carries its own action.** "Refresh Glow" sits inside the
  card that explains why it is needed, rather than being a setting to hunt for.
- **It answers "what matters right now?"** rather than "what does this app
  contain?"

Home and Profile were measured with the same tool on the same run. Home: 1
screen, adaptive, one clear job. Profile: 3.97 screens, fixed order, ~58% of it
settings and support. The difference is architecture, not effort.

**Carried forward for the deeper Mission 3 pass:** Home's adaptiveness has only
been observed in ONE account state (Muddies present, location stale, no Plans, no
Events, no messages). The brief asks for state-based Home behaviour across
brand-new / no-activity / imminent-Plan / live-Event users. Those fixtures do not
exist yet, so "Home adapts" is currently evidenced for a single state and must
not be claimed more broadly than that.
### MB-GOD-015 - Cross-surface IA sweep: Profile is the outlier, not the pattern

| Field | Value |
| --- | --- |
| **Surface** | All primary surfaces |
| **Severity** | n/a - **measurement, informs MB-GOD-013** |
| **Mission / Level** | Mission 2 Advanced / Mission 4 Advanced |
| **Status** | **RECORDED** |

Measured every primary surface the same way, same run, 393x852, tours dismissed.
This matters because it decides whether MB-GOD-013 is a Profile problem or a
house style — and the answer changes what should be done about it.

| Surface | Screens | First-view job |
| --- | ---: | --- |
| Home | 1.00 | "Refresh your Glow" — the one thing blocking this account |
| Messages | 1.00 | "Your conversations with Muddies, Circles and Plans" |
| Plans | 1.00 | "Plan something with your Muddies" + New plan |
| Events | 1.00 | "What is happening around you" + Create |
| Notifications | 1.00 | "What's happening with your Muddies" |
| Muddies | 1.04 | "Find and connect with Muddies near you" + Add Muddy |
| Linkr | 1.06 | "Meet people who are open to connecting" + Turn on Linkr |
| UpFor | 1.21 | "See what people are up for" + Live & temporary |
| **Settings** | **3.60** | "Manage your account and app preferences" |
| **Profile** | **3.97** | identity, then eight further sections |

**Nine of ten primary surfaces fit in roughly one screen and state their job in
their first line.** That is a strong result and it was not assumed — it was
measured.

Settings at 3.60 screens is **correct**: a settings index is meant to be a long
list of destinations, and its first view reads as one ("Account, Privacy,
Sessions…").

Which leaves **Profile as the single genuine outlier at 3.97 screens** — and
notably the only surface that is long WITHOUT being a list of destinations. It
is long because it accumulated sections.

**Why this strengthens rather than weakens MB-GOD-013.** If every surface were
4 screens deep, the fix would be a house-wide design-system problem and a much
larger argument. It is not: the team demonstrably builds tight, single-job
surfaces — nine times over. Profile drifted on its own, which makes the
restructuring plan a targeted correction rather than a redesign of the product's
character.

**Empty states, observed in passing** (the brief treats these as product, not
placeholder). Each states the situation and offers the next action rather than
stopping at "nothing here":

- Plans — "Nothing planned yet. Your upcoming plans will appear here." + New plan
- Events — "Nothing on yet. When you or your Muddies publish an event, it shows
  up here." + Create an event
- Notifications — "You're all caught up. New updates will appear here."
- UpFor — "Nothing happening yet" + Say / Start an UpFor

These are good. Recorded so the deeper Mission 2 pass does not spend time
re-deriving that they are fine.

**Not yet audited** (Mission 2 Advanced remains PARTIAL): Landing, Auth,
Activation, Conversation, Plan detail, Plan Chat, Event detail, Safe Arrival.
Eight surfaces, none of which have had the user-job / hierarchy treatment.
## MISSION 2 / 4 — Profile restructure IMPLEMENTED

### MB-GOD-013 (continued) - Profile restructured; measured before and after

**Status: FIXED (runtime-verified).** The audit's plan was implemented, with the
Settings receiving work landing first so no capability was ever homeless.

**Measured, same tool, same viewport (393x852), production build:**

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Total length | 3.97 screens (3382px) | **2.40 screens (2044px)** | **-40%** |
| Bio ("About") vertical position | y=2227 | **y=1267** | **-43%** |
| Settings / Support share | 28.6% | **0%** | removed |
| Identity share (Me + Showcase + About) | 29.1% | **48.1%** | **+65%** |
| Sections | 11 | **6** | |

With a more complete profile (institution and general_area set) the page settles
at **2.28 screens**, and `general_area` ("Legon") appears in the hero as the
brief specifies.

**Section order now:** Me (identity hero) → My Showcase → Complete your profile
(only while incomplete) → Interests → **About** → Activity.

**First view now reads:** *"Me · How you appear on Mad Buddy · QA Tester ·
@qatester · Legon · Visible to approved friends · [bio] · Edit profile ·
Membership · My Progress · MY SHOWCASE"* — unmistakably a person's profile.

**What moved, and where it went:**

| Removed from Profile | New home | Verified |
| --- | --- | --- |
| PRIVACY (Ghost Mode row) | `/settings/glow-visibility` | 200, linked from Settings |
| PREFERENCES (Account, Appearance, Devices) | `/settings`, `/settings/appearance`, `/settings/sessions` | 200, linked |
| SUPPORT (Help, Feedback, About) | `/help`, `/settings/feedback`, `/about` | 200, linked |
| JOURNEY card | `/buddy-score` (already rendered it in more detail) | 200 |
| PROGRESS / Buddy Score card | `/buddy-score` | 200 |

**The key discovery that made this safe.** Every row in Profile's Privacy,
Preferences and Support blocks was *already only a link* to a Settings
destination. Settings already indexes all of them under Account / Privacy &
safety / Preferences / Support & feedback. So these were a **duplicate index,
not a home** — removing them relocated nothing, it stopped repeating Settings on
an identity surface.

One genuine exception: **`/about` was the single destination Settings did not
list.** It was added to Settings' "Support & feedback" group **first**, before
the Profile block was removed, so version and legal information was never
unreachable for even one commit. `SettingsLinkRowProps` uses an explicit href
allow-list (a deliberate compile-time guard against dead links) which was
extended rather than widened to `Route`.

**Reachability proven at runtime, not by grep**
(`scripts/hardening/profile-reachability.mjs`): all 7 moved destinations return
200, and 6 of 7 are linked from Settings (the 7th is `/settings` itself, which
cannot link to itself — an earlier version of the check reported that as a false
MISS and was corrected). **0 unreachable destinations.**

**Three tests failed on this change, and all three were right to.** They are
recorded because how they were resolved matters:

1. `lib/tours/authoring.test.ts` — *"every registered target is actually rendered
   somewhere"* caught a **real defect**: the `profile-privacy` tour target was
   orphaned by the removal, and a **shipped migration row** references it as a
   live tour step. Deleting the target would have pointed that step at nothing.
   Re-anchored to the hero's visibility pill — which is precisely what survived
   of that responsibility on Profile — so the tour still works.
2. `lib/journey/journey-integration.test.ts` — asserted Profile renders its own
   Journey summary. Rewritten to assert the **consolidation** instead: the
   Journey must still exist (on `/buddy-score`), Profile must still offer a way
   to reach it (`href="/buddy-score"`), and Profile must not render a duplicate.
3. `lib/profile/identity.test.ts` — the privacy invariant (recent score activity
   is owner-only, not visible even to an approved Muddy) is **unchanged and still
   asserted**. Only the two source-string checks moved, and they were **inverted
   rather than deleted**: Profile must NOT contain the activity, `/buddy-score`
   must. The projection flag alone would still pass if a future change re-rendered
   it somewhere it should not appear, so the inverted assertions are load-bearing.

**Runtime gate.** `/profile`, `/settings`, `/buddy-score` and `/friends/kofim`
all clean at 360x800, 393x852, 430x932, light and dark: no overflow, no
sub-44px targets, no console errors.

**The Muddy view is correctly separate.** `/friends/kofim` renders at 1.65
screens with no self-only controls — no Edit profile, no Membership, no
completion card. A viewer sees identity and a Message action.

**Answering the brief's questions directly:**

- *Does the first screenful look like a profile?* Yes — identity, handle, area,
  visibility, bio, then Showcase.
- *Is identity visually dominant?* Yes — 48.1% of the page, up from 29.1%.
- *Is Showcase easy to discover?* Yes — second section, directly under the hero.
- *Is management subordinate to identity?* Yes — three buttons in the hero
  (Edit / Membership / My Progress) instead of three settings sections.
- *Are settings out of the way until requested?* Yes — 0% of Profile.
- *Can the owner still reach all previous functionality?* Yes — 7/7 destinations
  return 200, proven at runtime.
- *Is another viewer protected from self-only controls?* Yes — the Muddy view
  carries none of them.

### MB-GOD-016 - Back-link touch target, in two files from one copied class

| Field | Value |
| --- | --- |
| **Surface** | Muddy profile, Circle detail |
| **Severity** | P3 |
| **Category** | Mobile ergonomics / design-system drift |
| **Status** | **FIXED** |

The back link on `/friends/<username>` measured **74x20**. The identical class
string appears in `components/groups/group-detail-page.tsx` — the same copied-
pattern propagation that produced MB-GOD-005 across nine tab rows. Both fixed to
44px in the same change rather than one now and one when it is noticed later.
## MISSION 1 — Extremely Advanced: lifecycle and multi-tab sequences

### MB-GOD-017 - Muddy relationship lifecycle: 7/7, all meaningfully exercised

| Field | Value |
| --- | --- |
| **Surface** | Muddies / friend requests |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **VERIFIED** |

Full lifecycle driven against a real browser and a real database
(`scripts/hardening/seq-muddy-lifecycle.mjs`), with every assertion reading
Postgres directly:

```
PASS  request creates exactly one pending row          status 200, rows 1, status=pending
PASS  a repeated request does not create a duplicate   rows 1
PASS  two simultaneous requests still yield one row    rows 1 (statuses 200/400)
PASS  accept produces exactly one friendship row       friendships 1 (rpc ok)
PASS  blocking soft-ends rather than deleting          rows 1, ended_at set
PASS  reactivation reuses the same relationship id     same id: true
PASS  a blocked user does not appear in the Muddy list absent
```

The concurrency result is the notable one: two requests fired at the same instant
returned **200 and 400** with exactly **one** row. The server serialises and the
loser is cleanly refused, rather than both succeeding and leaving a duplicate.

The soft-ending property holds end to end: blocking sets `ended_at` instead of
deleting, and reactivation reuses the **same row id** — relationship identity
survives an ending and a restart, which is what `lib/life/` exists to guarantee.

**This test previously reported INCONCLUSIVE, and closing it out required three
harness fixes — each of which had been quietly producing a green result:**

1. The endpoint takes `targetUserId`; the probe sent `recipientId` → 400.
2. The column is `receiver_id`; the probe queried `recipient_id` → row counts
   came back `undefined`.
3. `accept_friend_request` takes `p_request_id`, not `request_id`. With the wrong
   name the RPC 404'd, and the assertion `fships.length <= 1` was **satisfied by
   zero rows** — a check that could not fail.

The previous session's ledger recorded the 400 as an anti-enumeration guard.
**That was wrong**, and is corrected here: it was a harness bug. The lesson holds
in the other direction too — an inconclusive result must be chased down, not
explained away with a plausible story.

### INVESTIGATED / NOT A DEFECT - `accept_friend_request` denies service_role

Calling the RPC with the service-role client returns `permission denied for
function accept_friend_request`. This is **correct and deliberate**: the
migration grants EXECUTE to `authenticated` only, so the function runs as the
real user and `auth.uid()` plus RLS decide what may be accepted. A service-role
caller would bypass exactly the check that makes it safe.

The harness now signs in as the receiver and calls it as that user, which is what
the app does.

### MB-GOD-018 - Multi-tab and stale-state behaviour: 5/5

| Field | Value |
| --- | --- |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **VERIFIED** |

```
PASS  same request fired from two tabs creates one row   rows 1 (400/200)
PASS  acting on a deleted resource creates no duplicate  rows 1
PASS  a request to someone who blocked you is refused    rows 0, status 400
PASS  no permanent loading state after stale interaction clean
PASS  a session-less tab cannot read an authenticated surface  → /login
```

Blocking is enforced **server-side**: a request to someone who has blocked you is
refused with no row written, regardless of what the sending tab believed.

**Harness note carried forward:** the friend-request endpoint is rate limited
(correctly). A preceding lifecycle run exhausts the quota, after which every
request returns `400 "Too many attempts"` and these checks measure the limiter
rather than the concurrency behaviour. `reset()` now clears `rate_limits` for the
test user. The limiter itself is untouched — it is a feature.

## MISSION 1 — God Mode: reachable-state graph

### MB-GOD-019 - State graph crawler, and the three ways it lied first

| Field | Value |
| --- | --- |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **IN PROGRESS** |

`scripts/hardening/state-graph.mjs` clicks every interactive control on every
core surface and records SOURCE → CONTROL → EXPECTED → ACTUAL → NEW STATE,
classifying each outcome as `nav` / `overlay` / `inline` / `self` / `dead`.

**It produced convincing false findings three times before it was trustworthy,
and all three are recorded because each would have wasted a session:**

1. **Fuzzy text selection** → 16 strict-mode violations. Several controls share a
   label ("Muddies" is a nav item, a section heading and a stat).
2. **Index-based selection** → **ten impossible "destination mismatches"**, e.g.
   `href=/moments` landing on `/notifications`. The order returned by an in-page
   `querySelectorAll` does **not** match Playwright's locator order, so `nth(i)`
   clicked a different element than was inventoried. Proven by instrumenting the
   skip: at the same index the href was `/moments` in one ordering and
   `/notifications` in the other. Every one of those ten was a harness artifact.
3. **Denied geolocation** → "Turn on Glow" on Home reported as a **dead control**.
   With permission granted it POSTs `/api/location/update` (200) and Home switches
   to its populated state. Denying a permission the product legitimately asks for
   turns a working feature into a false finding.

The crawler now selects by **identity** (href for links, exact accessible name
for handler-only buttons), re-checks that the element still matches before
clicking, scrolls it into view (several nav links live in a horizontally
scrolling rail — fully visible, but outside the viewport), grants geolocation,
and classifies a link to the already-open page as `self` rather than `dead`.

**Result on the first four surfaces after those corrections: 28 edges, ZERO
destination mismatches, ZERO dead controls.**

That is the honest headline. The earlier "10 mismatches + 6 dead" was my
instrument, not the product.
### MB-GOD-020 - Account data export returned 500 for every user

| Field | Value |
| --- | --- |
| **Surface** | Settings → Data → Export your data |
| **Route** | `GET /api/account/export` |
| **Severity** | **P1** — a compliance-relevant feature, broken for 100% of users |
| **Category** | Correctness / data rights |
| **Mission / Level** | Mission 1 - God Mode (found by the state-graph crawl) |
| **Status** | **FIXED (runtime-verified, mutation-tested)** |

**Reproduction.** Settings → "Export data".

**Actual.** `GET /api/account/export` → **500**,
`{"error":"Your data export could not be prepared."}`

**Root cause.** The route selected `profiles.onboarding_complete`. That column
does not exist — the real one is **`is_onboarded`**. Postgres rejects the entire
query with `42703 (undefined_column)`, so the export failed for everyone, always.

`onboarding_complete` appears in exactly **one place in the whole repository**:
this broken query. It was never a rename that missed a call site; it was wrong
from the start.

**Why nothing caught it:**

- **TypeScript could not.** A Supabase select list is a plain **string**, so a
  wrong column name is not a type error.
- **No test covered it**, because exercising the route needs a live database.
- **The route discarded the error.** `[...].find((r) => r.error)` then returned a
  generic message without logging, so the failure was undiagnosable from
  outside: the export silently stopped working and nothing recorded why.

It was found by the God Mode click-crawl noticing a 500 in the console while
clicking every control on `/settings` — precisely the class of defect the brief
predicted a state graph would surface and ordinary testing would not.

**Fix, in two parts.**

1. **The column**: `onboarding_complete` → `is_onboarded`.
2. **The silence**: the Postgres error is now logged through
   `logBackendEvent` — the app's privacy-safe channel, which strips location,
   tokens and secrets — recording the error **code** (`PostgrestError:42703`) and
   a hashed user id, never the message or any user data. This is what turned an
   opaque 500 into a one-line diagnosis, and it did so within a single run.

**Verification (production build, real session):**

```
before:  GET /api/account/export -> 500  {"error":"Your data export could not be prepared."}
log:     errorType "PostgrestError:42703"   (undefined_column)
after:   GET /api/account/export -> 200, 18 sections:
         profile, subscription, preferences, currentLocation, friendships,
         friendRequests, blockedUsers, notifications, reports, consentLogs,
         friendCircles, privacyZones, meetupRequests, bestBuddies, eventModes,
         appFeedback, supportRequests, mediaAssets
```

**Regression guard** — `lib/account/export-columns.test.ts`. Compares every
column named in the route's select lists against the **generated database
types**, so it cannot drift from the real schema, and runs without a database.
Four tests, including one asserting the scanner finds queries at all so the
others cannot pass vacuously, and one asserting the error is still logged.

**Mutation-tested.** Reintroducing `onboarding_complete` fails two assertions and
names the offending column exactly:

```
× selects only columns that exist in the database types
    expected [ 'profiles.onboarding_complete' ] to deeply equal []
× still exports the onboarding flag under its real name
```

**One harness correction recorded**: the guard's first version searched the
generated types for `"Row: {"` and matched nothing, because Row is declared as
`Row: RowWithTimestamps & {` — an intersection. It reported **thirty existing
columns as missing**, including `profiles.full_name`. Fixed to anchor on `Row:`,
brace-match its block, and include the intersected shared columns.

### INVESTIGATED / NOT A DEFECT - nine "dead" controls in the state graph

The full crawl (34 nodes, 193 edges) reported nine dead controls. All nine are
the **already-active tab** on their surface — "For You" on UpFor, "All" on
Messages and Notifications, "Upcoming" on Plans, "Home" on Events, "My Circles"
on Circles. Clicking the tab you are already on correctly does nothing.

The crawler classifies a *link* to the current page as `self`, but these are
handler-only `<button role="tab">` elements with no href, so the same reasoning
cannot be applied automatically. Left reported rather than suppressed: the
distinction needs a per-surface notion of "current tab", and silencing it
generically risks hiding a genuinely dead tab later.

"Open quick actions" on `/buddy-score` is the same story — it opens a launcher
whose content did not change the first 900 characters of body text.
## MISSION 1 — God Mode: database contract and error observability

### MB-GOD-021 - MB-GOD-020's defect class does NOT recur (class-based search)

| Field | Value |
| --- | --- |
| **Severity** | n/a - **negative finding, deliberately recorded** |
| **Category** | Database contract |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **VERIFIED CLEAN** |

The brief's instruction after MB-GOD-020 was explicit: *do not assume the account
export was the only place*. `scripts/hardening/db-contract.mjs` checks every
`.from("table").select("…")` and every `.eq/.neq/.gt/.lt/.is/.in/.order("column")`
in `app/` and `lib/` against the **generated database types**.

```
files scanned        : 553
select lists checked : 1081
filters checked      : 1165
result               : NO UNKNOWN COLUMNS
```

**Mutation-tested, so "clean" means something.** Reintroducing the original bug
is caught exactly:

```
1 REFERENCE(S) TO COLUMNS NOT IN THE GENERATED TYPES:
  app/api/account/export/route.ts:56
      profiles.onboarding_complete   (.select)
```

Restoring the fix returns it to clean. A checker that reports nothing and cannot
report anything is worthless; this one demonstrably detects the defect it was
built for.

**The checker was wrong three times first, and each error inflated the count.**
Recorded because every intermediate number looked like a real finding:

| Attempt | Reported | Cause |
| ---: | ---: | --- |
| 1 | **161** | Column names matched only at line starts, so tables whose `Row` is declared on ONE line (`Row: { id: string; user_id: string; … }`) reported *every* column as unknown. Verified against the live DB: `earned_premium_rewards` has 15 columns and exists. |
| 2 | **28** | Embedded relations were split on commas, so `plans!inner(status, completed_at, end_at)` made `completed_at` look like a column of `plan_participants`. All three survivors (`tour_versions.title`, `tour_versions.description`, `plan_participants.completed_at`) were embeds. |
| 3 | **23** | Columns preceded by a **comment line** were missed, e.g. `profiles.username_normalized` sits under `// Added by the batch-9 profiles migration`. |
| final | **0** | — |

Every intermediate finding was checked against the **live schema** with
`information_schema.columns` before being believed. That is what stopped 161
fabricated defects from reaching this ledger.

**Two tables are skipped** because they are absent from the generated types:
`account_deletion_requests`, `user_phone_identities`. They exist in the database;
the types are simply not regenerated for them. Not a defect — but it means the
guard cannot cover those two, which is worth knowing.

### MB-GOD-022 - Six API routes returned 5xx while discarding the cause

| Field | Value |
| --- | --- |
| **Surface** | Notifications, Billing, Push subscriptions |
| **Severity** | P2 |
| **Category** | Error observability |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **FIXED** |

MB-GOD-020 had two halves. The wrong column was the bug; the **discarded error**
is why it survived undetected for the route's whole life. So the same question
was asked of every API route: does it record the cause of a 5xx?

`scripts/hardening/error-observability.mjs` scanned all **67** routes and found
**six** returning 500 with the database error thrown away:

| Route | Action |
| --- | --- |
| `app/api/notifications/route.ts` | list |
| `app/api/notifications/route.ts` | update |
| `app/api/notifications/read/route.ts` | mark read |
| `app/api/notifications/unread-count/route.ts` | unread count |
| `app/api/billing/status/route.ts` | subscription status |
| `app/api/push-subscriptions/route.ts` | replace subscription |

`/api/notifications` is notable: it produced an **undiagnosable 500 in session 2**
that cost real time to trace, precisely because the cause was discarded.

**Fix.** Each now calls `logBackendEvent("error", …)` before returning. The
user-facing message stays deliberately vague — it must not leak schema detail —
but the internal record now carries the route, the action, the status and the
Postgres **error code** via `errorType()`. Never the message, never user data:
`logBackendEvent` strips location, tokens and secrets by construction.

The push-subscription case matters more than it looks: a subscription that
silently fails to replace leaves that device receiving **no notifications at
all**, with nothing recorded to explain why.

**After: all 67 routes record the cause of any 5xx.**

### INVESTIGATED / NOT A DEFECT - `app/api/billing/trials` "missing" logging

Flagged by the observability checker, but its only 5xx is `status: 503` for
absent Supabase configuration — a missing-env-var guard, not a swallowed
database error, and the message already says everything there is to record. Its
real failure paths return 401, 429 and 409. The checker now matches only
500/501/502/504 so this does not recur as noise.
### MB-GOD-023 - UpFor → Plan → RSVP lifecycle: 7/7, canonical invariants hold

| Field | Value |
| --- | --- |
| **Surface** | UpFor, Plans, Plan Chat |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **VERIFIED** |

The Product Constitution's hard rule for this path is that **one UpFor converts
into exactly one canonical Plan**. So the conversion is fired **twice
simultaneously** with the same idempotency key — a double-tap — and the result is
counted in Postgres rather than read off the UI.

```
PASS  an UpFor session is created active
PASS  two participants joined                              requests 2
PASS  one UpFor converts into exactly one Plan             plans 1  (rpc: ok/ok)
PASS  the Plan records the UpFor it came from              source_hangout_id set
PASS  the Plan is owned by the UpFor host                  creator_id correct
PASS  the Plan has at most one canonical conversation      conversations 0
PASS  RSVP changes update one row rather than adding rows  rows 1, final "going"
```

**The concurrency result is the important one.** Both calls returned **ok** and
exactly **one** Plan exists. The migration explains why, and the comment is worth
quoting because it shows the mechanism was designed rather than accidental:

```sql
-- A real source row is stronger than an advisory lock. The second
-- concurrent converter waits here and then observes converted_plan_id.
select hs.id, hs.owner_id, hs.status, hs.converted_plan_id
  into v_hangout
from public.hangout_sessions as hs
where hs.id = p_source_hangout_id
for update;
```

The second converter does not fail — it waits on the row lock, sees the Plan the
first one created, and returns it. That is a better outcome than an error: a
double-tap gets the Plan, not a failure message.

RSVP was cycled **going → maybe → not_going → going** and produced **one**
participant row, not four.

**Five harness corrections were needed to reach a real result, every one of them
reported as INCONCLUSIVE rather than passed.** Recorded because the sequence is
itself the evidence that "setup failed" is never allowed to read as PASS:

| Attempt | Reported | Cause |
| --- | --- | --- |
| 1 | INCONC | `hangout_sessions.activity` — the column is `activity_type` |
| 2 | INCONC | `audience_type: "muddies"` — must be `all_muddies` (check constraint) |
| 3 | INCONC | `create_plan_lifecycle` signature: 18 parameters, not 3 |
| 4 | INCONC | `PLAN_REQUEST_KEY_INVALID` — the key must be a **UUID** |
| 5 | INCONC | `PLAN_TYPE_INVALID` — must be `quick`/`scheduled`/`poll` |
| 6 | INCONC | `set_plan_participant_rsvp(p_actor_id, p_plan_id, p_status)` — no `p_user_id` |
| final | **7/7** | — |

Two of those "failures" are actually **product strengths** found by tripping over
them:

- **`PLAN_REQUEST_KEY_INVALID`** — the idempotency key is validated as a UUID by
  the database itself, so a client cannot pass a weak or colliding key.
- **`set_plan_participant_rsvp` takes no `p_user_id`.** A participant sets their
  OWN RSVP; there is no parameter through which one person could RSVP on
  another's behalf. The authorization model is enforced by the signature.

**Note on `conversations 0`:** the converted Plan had no Plan Chat row yet, which
is consistent with `reconcile_plan_conversation_members` creating it on first
use rather than eagerly at conversion. The assertion is `<= 1` (never two), which
is the invariant that matters; whether it is created eagerly or lazily is a
separate question carried to the Plan Chat sequence.
### MB-GOD-024 - Linkr lifecycle: 7/7, one-sided privacy verified against persisted authority

| Field | Value |
| --- | --- |
| **Surface** | Linkr |
| **Severity** | n/a - **verification, no product defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **VERIFIED** |

The rule here is a **privacy** rule, not merely a correctness one: a one-sided
Connect must stay invisible to its target. If the person you tapped Connect on
can tell, Linkr stops being safe to use. So every assertion reads persisted
authority (`linkr_actions`, `linkr_connections`) — never client state, because
client state is exactly what a leak would travel through.

```
PASS  a one-sided Connect creates NO mutual connection          connections 0
PASS  the one-sided interest is recorded for the actor only     actor rows 1, action=connect
PASS  the target CANNOT see who connected with them             rows visible to target: 0
PASS  no notification tells the target about one-sided interest linkr notifications: 0
PASS  a reciprocal Connect creates exactly one mutual connection connections 1
PASS  the connection is stored in canonical low/high order      canonical pair row
PASS  two simultaneous reciprocal Connects yield exactly ONE    connections 1 (rpc ok/ok)
```

The privacy check is the one that matters most and it is **read as the target,
under RLS** — signed in as `saa@local.test`, querying `linkr_actions` filtered to
rows about themselves. Zero rows come back. A notification would leak the same
fact just as effectively, so that is asserted separately; also zero.

`linkr_connections` uses canonical `user_low`/`user_high` ordering, the same
identity pattern as `friendships`, so a pair cannot be inserted twice under two
orientations. Two simultaneous reciprocal Connects produced exactly one row.

### INVESTIGATED / NOT A DEFECT - `linkr_record_connect` performs no block check

A probe called the RPC **directly** with a block in place, watched a connection
form, and it looked like a **P0 privacy defect**.

It is not. The RPC is deliberately narrow — its own comment reads *"Did they
already choose us? Only this function may ask"* — and the block check lives one
layer up in `connectWithCandidate` (`lib/linkr/connection-service.ts:116`), which
runs `isBlockedEitherDirection` **before** the RPC and then returns a result
**indistinguishable from an ordinary private Connect**. The source comment there
is explicit about why: *"Telling the caller 'you are blocked' would turn Connect
into a block detector."*

The same guard re-checks, against a stale deck: Linkr enabled, ghost mode,
deletion, age ≥ 18, and profile photo — each failing silently for the same
reason. That is careful work.

**The product was right; the probe was wrong.** It had bypassed the authorization
layer by calling the database function directly.

### MB-GOD-025 - The Linkr block guard had no test, and the first one written was weak

| Field | Value |
| --- | --- |
| **Surface** | Linkr |
| **Severity** | P2 (test coverage of a privacy-critical guard) |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **FIXED** |

The false alarm above exposed a real gap: **nothing asserted that the block guard
stays where it is.** A refactor moving the check below the RPC — or dropping it
on the assumption that the database enforces it — would let a blocked person form
a Linkr connection, and no test would notice.

`lib/linkr/connect-block-guard.test.ts` now asserts two load-bearing properties:

1. **Order** — `isBlockedEitherDirection` must appear before `linkr_record_connect`.
2. **Silence** — the blocked branch must return `ok: true, matched: false` with no
   wording naming a block, so Connect cannot be used as a block detector.

Plus the stale-deck re-checks, and Pass's deliberate *asymmetry*.

**The first version of this test was itself weak, and mutation testing proved
it.** Disabling the guard with `if (false && await isBlockedEitherDirection(…))`
**still passed** — the call was present, at the right position, and doing
nothing. A source-level guard that only proves a string exists is worth very
little.

Reachability assertions were added, and both mutations are now caught:

```
short-circuit  →  × the block check has been short-circuited
                    expected 'if (false && await ' not to match /false\s*&&/
guard removed   →  × connectWithCandidate no longer checks isBlockedEitherDirection
                  × expected 'return { ok: false, … }' to contain 'ok: true'
restored        →  4 passed
```

**Recorded honestly:** this is still a source-level guard, not a behavioural one.
It cannot prove the check *works*, only that it is present, positioned and not
obviously neutered. `connectWithCandidate` is a server action rather than an API
route, so it cannot be driven from the runtime harness. A behavioural test would
need the action invoked through the framework — worth doing, and noted as the
stronger version of this guard rather than pretended to be already done.

**Also corrected in this test:** an assertion that `passCandidate` should check
blocks. It should not. Passing writes a private "not interested" row, creates no
connection, no conversation and no visibility to the target, so there is nothing
a block would protect — and it is the most frequently tapped control in the deck.
Connect differs precisely because it can CREATE something. The asymmetry is now
documented rather than "fixed".
### MB-GOD-026 - Safe Arrival lifecycle: 5/5, and the privacy guarantee is structural

| Field | Value |
| --- | --- |
| **Surface** | Safe Arrival |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **VERIFIED** |

```
PASS  the Safe Arrival session schema has no location column at all
PASS  a Safe Arrival session starts active
PASS  the documented states are all reachable    grace_period → extended → unconfirmed → completed
PASS  a completed session records when it was confirmed
PASS  no emergency/alarm language in the surface  10 files scanned, none
```

**The strongest result is the first one, and it is structural.** The privacy
guarantee is not "we are careful not to send coordinates" — it is that
`safe_arrival_sessions` **has nowhere to put them**:

```
id, traveller_id, destination_type, destination_label, destination_event_id,
expected_arrival_at, grace_period_minutes, note, status, started_at,
confirmed_at, cancelled_at, unconfirmed_notified_at, created_at, updated_at
```

No latitude, longitude, geohash, accuracy or point column exists. The destination
is a **text label** the traveller writes. A leak would require a schema change,
which is a far better guarantee than a code review.

The state machine has nine documented states
(`draft`, `pending_acknowledgement`, `active`, `grace_period`, `extended`,
`completed`, `cancelled`, `expired`, `unconfirmed`) and the ones the product
actually walks were exercised end to end.

**"Waiting" stays neutral.** An unconfirmed arrival means the timer elapsed and
nothing more. Ten source files were scanned for escalation language —
`emergency`, `danger`, `911`, `999`, `police`, `missing person`,
`help is on the way`, `sos` — and none appears in user-facing copy. That matters
because escalating a flat battery into a crisis would teach people to ignore the
one signal that should never be ignored.

**Two harness errors, both of which produced a green result that meant nothing:**

1. **The copy check scanned ZERO files.** It guessed `components/safe-arrival/`
   and `lib/safe-arrival/`; the real directories are `components/safety/` and
   `lib/safety/`. It reported PASS on an empty scan. The check now **fails** if
   it reads no files, and prints the count in its result — "0 files scanned" must
   never look like a clean bill of health.
2. **`variant="danger"` was flagged as alarm language.** It is a Button style
   prop, not something a user reads. Prop values are now excluded (preceded by
   `name=`, and real copy contains whitespace).

Both are the same trap in different costumes: a check that cannot fail, and a
check that fails on the wrong thing. The first is more dangerous, because it
looks like success.
## LIFECYCLE DOMAIN RECONCILIATION (correction to sessions 5-7 reporting)

### MB-GOD-027 - The reported lifecycle count was wrong: 3/7, not 5/7

| Field | Value |
| --- | --- |
| **Category** | Reporting accuracy |
| **Mission / Level** | Mission 1 - Extremely Advanced |
| **Status** | **CORRECTED** |

The session 7 checkpoint reported `LIFECYCLES COMPLETE = 5 / 7` while its own
"Not done" section named **three** remaining areas. Those two statements cannot
both be true, and the discrepancy was noticed by the reader, not by me.

Traced to **two compounding errors of my own**:

1. **I counted a technique as a domain.** MB-GOD-018 is *multi-tab / stale-state
   behaviour* — a cross-cutting method applied WITHIN lifecycles, not a lifecycle
   of its own. Counting it inflated the numerator by one.
2. **I counted a half-domain as whole.** The original brief groups **Safe Arrival
   + Messages** as one domain ("Treat as two sub-sequences if necessary").
   Safe Arrival was verified (MB-GOD-026, 5/5); Messages had no coverage at all.
   Reporting that domain complete inflated the numerator again.

**No historical evidence was altered to make the numbers fit.** Every finding
MB-GOD-017/018/023/024/026 stands exactly as recorded and was genuinely
exercised. What was wrong is the *arithmetic over them*, and only that is
corrected.

### The seven canonical domains, fixed from here on

Taken from the original program brief's own enumeration, so the denominator
cannot drift again:

| # | Canonical domain | Status | Valid sequence coverage | Multi-tab coverage |
| --- | --- | --- | --- | --- |
| 1 | Muddy relationship | **COMPLETE** | 7/7 (MB-GOD-017) | Yes (MB-GOD-018, 5/5) |
| 2 | Linkr | **COMPLETE** | 7/7 (MB-GOD-024) | No |
| 3 | UpFor → Plan | **COMPLETE** | 7/7 (MB-GOD-023) | No |
| 4 | Plan RSVP / membership | **COMPLETE** | 10/10 (MB-GOD-029) — RSVP cycle, add participant, Plan Chat reconciliation, outsider exclusion | Yes (1: stale RSVP replay) |
| 5 | Event check-in / Event Linkr | **COMPLETE** | Consent 8/8 (MB-GOD-028) + audiences 12/12 (MB-GOD-031) + wiring 9/9 (MB-GOD-032) | Yes (1: stale eligibility) |
| 6 | Profile media | **COMPLETE** | 10/10 (MB-GOD-034) + EXIF 4/4 mutation-tested (MB-GOD-033) | Yes (1: stale slot delete) |
| 7 | Safe Arrival + Messages | **COMPLETE** | Safe Arrival 5/5 (MB-GOD-026) + Messages 8/8 (MB-GOD-030) | Yes (1: stale membership send) |

**LIFECYCLES COMPLETE = 7 / 7** (updated after MB-GOD-034). **MISSION 1 EXTREME = COMPLETE.**

**Multi-tab coverage is thinner than the raw "5 scenarios" figure suggests**: all
five sit inside domain 1. Four of the seven domains have no stale-state coverage
at all.

### Standing reporting rule (adopted)

From here on, every checkpoint reports the four columns above per domain —
`CANONICAL DOMAIN / STATUS / VALID SEQUENCE COVERAGE / MULTI-TAB COVERAGE` —
rather than a bare fraction. A single number was what allowed two independent
errors to hide inside it, and neither would have survived a per-domain table.

### Standing testing principle (adopted)

**Test the public authority, not merely the deepest callable primitive.**

Earned the hard way this session: a probe called `linkr_record_connect` directly,
saw a connection form despite a block, and it looked like a P0 privacy defect.
The RPC is deliberately reciprocity-only; the block guard lives in
`connectWithCandidate`, the actual product-facing authority. The probe had
bypassed the authorization layer and was testing a primitive no product path
calls unguarded.

The corollary matters as much: when a primitive *appears* to permit something
forbidden, the question is "which layer is the authority?" before "is this a
defect?".
### MB-GOD-028 - Event Linkr consent: presence does not imply discoverability

| Field | Value |
| --- | --- |
| **Surface** | Events, Event Linkr |
| **Severity** | n/a - **verification, no defect found** |
| **Category** | Privacy / consent |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 5) |
| **Status** | **VERIFIED (behavioural, mutation-tested)** |

Three things must never be conflated, each strictly narrower than the last:

```
GOING       I intend to attend.
CHECK-IN    I am physically here.
EVENT LINKR I am open to meeting new people here.
```

Only the third is consent to be discovered. Collapsing any two would mean
someone who merely showed up becomes discoverable without ever saying yes.

**This is tested against the real authority, not a reconstruction of it.**
`isCandidateEligible` (`lib/linkr/rules.ts`) is the single function that decides
discoverability, and it is **pure** — so unlike the Linkr block guard, this could
be exercised behaviourally rather than by reading source. Its own comment states
the governing property: *"Event Mode narrows; it never widens."*

```
PASS  an ordinary eligible candidate is eligible (baseline is not vacuous)
PASS  being at the Event does NOT make someone discoverable   → not_event_eligible
PASS  opting in to Event Linkr is what makes someone discoverable
PASS  Event Mode narrows and never widens: cannot rescue an ineligible candidate
PASS  a block beats Event eligibility, decided before anything else  → blocked
PASS  revoking Event eligibility removes discoverability immediately
PASS  an existing connection is excluded from candidacy, not re-offered
PASS  presence expiry removes an attendee who has gone stale
```

The first assertion exists so the rest cannot pass vacuously: if the fixture were
ineligible for some unrelated reason, every "not eligible" assertion below would
succeed for the wrong reason.

**Mutation-tested on the two safety-critical properties:**

| Mutation | Result |
| --- | --- |
| Make attendance imply consent (`false && input.eventModeActive && …`) | **2 tests fail** |
| Let Event Mode bypass blocking (`blocked && !eventModeActive`) | **1 test fails** |
| Restored | 8 passed |

**"Revoke removes discoverability immediately" is the load-bearing one.**
Checkout, opt-out and Event end all converge on the same signal — `eventEligible`
goes false — and the next evaluation excludes the candidate. There is no grace
window in which a departed attendee stays visible.

**Existing matches survive** by construction rather than by special-casing: an
already-connected pair is excluded from *candidacy* (`already_connected`), which
removes them from future discovery without touching the connection or its
conversation. Revocation narrows who can be FOUND; it does not reach back into
what was already legitimately created.

**Not covered here, and carried forward:** the wiring from a check-out/Event-end
*event* to `eventEligible` being recomputed lives in `candidate-service.ts` and
was not driven end to end. The decision authority is proven; the plumbing that
feeds it is not. Also not covered: attendee-directory enumeration against live
API payloads, and the five audience authorities (invite / link / community /
nearby / public) — the visibility column and its check constraint were confirmed,
but authorization was not exercised per audience.
### MB-GOD-029 - Plan RSVP / membership: 10/10, domain 4 COMPLETE

| Field | Value |
| --- | --- |
| **Surface** | Plans, Plan Chat |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 4) |
| **Status** | **VERIFIED — domain COMPLETE** |

RSVP transitions were already covered inside the UpFor→Plan sequence. This adds
**membership**: adding participants through the canonical authority, and proving
Plan Chat membership *follows* from it rather than being maintained separately.

```
PASS  a Plan is created with its invitee as a participant          participants 2
PASS  a full RSVP cycle leaves exactly one participant row         rows 1, final going
PASS  the host can add a participant                               participants 3
PASS  adding the same participant twice does not duplicate them    rows 1
PASS  a Plan has exactly one canonical conversation                conversations 1
PASS  everyone who is going is a member of the Plan Chat           going 2, members 2
PASS  an invitee who has not accepted is NOT yet in the Plan Chat  none in chat
PASS  a non-participant is NOT a member of the Plan Chat           outsider absent
PASS  re-reconciling does not duplicate conversation members       rows 2, distinct 2
PASS  a stale RSVP replay leaves one row and the server's value    rows 1, going
```

**The membership rule was discovered, not assumed — and the first assertion was
wrong.** An initial version asserted "all participants are members of the Plan
Chat" and passed, but only because the host and the invitee happened to be
`going` at that moment. Inspecting persisted state on a fresh Plan showed
**3 participants / 1 chat member**:

```
PARTICIPANTS:  QA(host) rsvp=going role=host
               KOFI(invited) rsvp=invited role=participant
               AMA(added)    rsvp=invited role=participant
CHAT MEMBERS:  QA(host) status=joined
```

The real rule is that **Plan Chat membership follows RSVP, not invitation** — you
join when you accept, because a Plan Chat is for the people actually coming. The
assertions now test that, in both directions: everyone going is a member, and
every invitee who has not accepted is not.

**Multi-tab (domain 4, first stale-state coverage outside domain 1):** Tab B
declines while Tab A holds a stale "going" view and re-sends it. Server truth
wins, one row, latest value.

### INVESTIGATED / NOT A DEFECT - "conversations 0" in the earlier UpFor sequence

MB-GOD-023 reported `conversations 0` for a converted Plan and speculated that
Plan Chat might be created lazily. **That was a wrong query, not lazy creation.**

Conversations link to their Plan via `context_type = 'plan'` / `context_id`, not
a `plan_id` column. The probe filtered on `conversations.plan_id`, matched
nothing, and read the empty result as meaningful. Corrected here: a Plan has
exactly **one** canonical conversation, created eagerly.

The MB-GOD-023 assertion (`<= 1`, never two) was still correct and still holds —
it simply passed for a weaker reason than it appeared to.
### MB-GOD-030 - Messages: 8/8, domain 7 COMPLETE

| Field | Value |
| --- | --- |
| **Surface** | Messages, conversations |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 7b) |
| **Status** | **VERIFIED — domain 7 COMPLETE (Safe Arrival + Messages)** |

The missing half of domain 7. Three properties dominate, each enforced in a
different place:

```
PASS  a two-member conversation exists                              QA + KOFI joined
PASS  a message sends                                               inserted
PASS  the same client_message_id twice yields exactly one message   rows 1 (ok/err)
PASS  identical text with different client ids stays two messages   rows 2
PASS  a system message has no sender, so it cannot read as waiting  system rows 1, sender null
PASS  a non-member reads ZERO messages from the conversation        rows visible: 0
PASS  a non-member cannot read the conversation row itself          rows visible: 0
PASS  a removed member's stale tab cannot post into the conversation rows written: 0 (refused)
```

**Idempotency is enforced by the database, not by button timing.** A unique
index does the work:

```sql
messages_idempotency_unique
  ON public.messages (sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL AND sender_id IS NOT NULL
```

Two concurrent inserts with the **same** `client_message_id` produced `ok/err`
and exactly **one** row — the real shape of a double-tap or a retry after the
client never saw the first response. The disabled-button trick is not what is
holding this together, which matters because that trick fails precisely when the
network is slow.

The **converse** is tested too, because over-deduplicating is its own defect:
identical text sent with two different client ids stays two messages. Someone
typing "ok" twice must get two messages.

There is a second index, `messages_system_event_dedupe_idx` on
`(conversation_id, client_message_id) WHERE message_type = 'system'`, so a
lifecycle notice cannot be emitted twice for one event either.

**System messages carry `sender_id = NULL`**, which is what stops them reading as
"someone is waiting for a reply". The unread badge counts *people*, and a system
notice has no person behind it.

**Membership privacy is proven under RLS, as the outsider** — not by observing
that the UI declines to render. A non-member reads **zero** messages and cannot
even read the conversation row.

**Multi-tab (domain 7, stale membership):** the member is removed
(`status='left'`, `left_at` set), then that user's own still-open tab attempts to
post using their own credentials. The write is **refused**. A stale tab cannot
outlive its membership.

**One harness correction:** the first system-message insert used
`system_event_type: "plan_created"`, which is not in the enum — the constraint
lists `plan_confirmed`, `plan_time_changed`, `plan_place_changed`,
`plan_cancelled`, `poll_confirmed`, `participant_joined`, `participant_left`,
`conversation_created`, `member_promoted`, `member_demoted`,
`ownership_transferred`, `participant_removed`, `group_renamed`,
`group_avatar_changed`. The check failed honestly (0 system rows) rather than
passing, and surfacing the insert error named the constraint immediately.

**Not covered, and carried forward:** voice and media messages, the unread count
as computed by `conversation_previews` across the list/badge/notification
surfaces, and read-receipt reconciliation. The *storage* invariants are proven;
the *projection* of unread into the three UI surfaces is not.
### MB-GOD-031 - Event audiences: five audiences × three authorities, 12/12

| Field | Value |
| --- | --- |
| **Surface** | Events |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 5) |
| **Status** | **VERIFIED (behavioural, mutation-tested)** |

Three genuinely different questions, never to be collapsed into one "can see
event" check:

```
isDiscoverableInFeed   may this be BROWSED to?
canViewEvent           may this be OPENED when the id is already held?
isBroadlyRankable      may this claim to be trending across Mad Buddy?
```

The full matrix, asserted (`lib/events/audience-matrix.test.ts`):

| visibility | discoverable | viewable | broadly rankable |
| --- | --- | --- | --- |
| public | yes | yes | **yes** |
| nearby | yes | yes | **yes** |
| community (untargeted) | yes | yes | no |
| community (targeted) | members only | members only | no |
| link | **no** | **yes** | no |
| invite | no | invite list | no |
| unknown | no | no | no |

**`link` is the asymmetry, and it is the point.** Not browsable, but openable by
anyone holding the URL — sharing is *transport*, and possession of the link IS
the permission for that audience. Collapsing the two questions would either
break sharing or leak private Events into the feed.

**Ranking is stricter than browsing.** A community Event is legitimately
discoverable by its members, but "trending across Mad Buddy" is a claim about the
whole product. The source states it well: *"a private wedding with five thousand
Going can never rank"* — visibility is asked before any score is calculated.

Also verified: a **draft** is invisible to everyone but its host in every
audience; the host always sees their own; an **unknown** audience fails closed in
all three authorities; and no audience makes a private Event rankable, so sharing
cannot widen ranking.

**Mutation-tested:** making `link` discoverable fails 2 tests; making `community`
broadly rankable fails 3 (one by name).

### MB-GOD-032 - Event check-in / Event Linkr wiring: 9/9, domain 5 COMPLETE

| Field | Value |
| --- | --- |
| **Surface** | Events, Event Linkr, Linkr candidates |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 5) |
| **Status** | **VERIFIED — domain COMPLETE** |

MB-GOD-028 proved the *rules*. This proves the system **recomputes from changed
state** — where the rules could be right and the product still wrong.

```
PASS  a checked-in, opted-in attendee at a live Event is eligible   reason eligible
PASS  checking out removes eligibility immediately                  reason not_checked_in
PASS  checking back in restores eligibility                         recomputed live
PASS  opting out removes eligibility while still checked in         reason no_consent
PASS  an Event that has ended removes eligibility                   reason event_not_live
PASS  a cancelled Event removes eligibility before its end time     reason event_not_live
PASS  a draft Event never confers eligibility                       reason event_not_live
PASS  a stale tab cannot preserve revoked Event eligibility         eligible → not_checked_in
PASS  the consent set is narrower than the attendee set             2 of 2
```

Each assertion checks the **reason**, not just the boolean — a right answer for
the wrong cause would be a latent defect.

**Why revocation is immediate: there is nothing to go stale.**
`resolveEventLinkrEligibility` reads liveness, then check-in, then consent, live
from the database on every call. No cached eligibility column exists, so a
checkout is visible on the very next evaluation.

**Three separate statements, three separate tables** — the distinction this
domain exists to protect:

```
event_rsvps.status = 'going'          I intend to come      (RSVP)
check_ins.status = 'checked_in'       I am here             (presence)
event_linkr_opt_ins.enabled = true    I am open to meeting  (consent)
```

`check_ins.event_glow_enabled` is a **fourth** flag: Event Glow is not Event
Linkr consent either.

**The seam is exemplary and is asserted** (`lib/events/linkr-consent-wiring.test.ts`):
`lib/linkr/event-mode-adapter.ts` is the only place Linkr knows Events exist, it
re-derives nothing, and it **fails closed** when the consent module is absent —
*"no consent module means no Event Mode, never assume everyone consented"*.
Linkr intersects the attendee set rather than adding to it, and an empty set
short-circuits so Event Mode can never widen the ordinary pool.

Granting consent **requires a live check-in**; withdrawing it never does. That
asymmetry is deliberate: withdrawal must not be harder than granting, including
for someone who has already left.

**A weak assertion of mine, caught by mutation testing.** The fail-closed check
first asserted only that `return new Set()` appeared somewhere in the function.
Mutating the guard to `return new Set([viewerId])` — which fails **open** by
seeding the pool with a real id — **still passed**, because the string survived
elsewhere. The assertion now reads each guard line and rejects any that returns a
non-empty set or an eligible verdict. Re-mutated: caught, naming the line.

That correction also surfaced a **third** guard I had not accounted for —
`describeEventLinkrPool`, which returns display copy rather than access. Demanding
an empty Set from it would have been wrong, so the assertion targets
access-granting shapes specifically.

**Multi-tab (domain 5):** a candidate list computed while the attendee was
eligible, then a checkout, then an action — `eligible → not_checked_in`. A stale
tab has no cached verdict to rely on.

**Not covered, carried forward:** attendee enumeration against live HTTP payloads
with a large seeded attendee set. The *data* contract is proven (ids only, and
only of consenting attendees), and the source is explicit that
`eventLinkrCandidateIds` returns *"IDS ONLY… deliberately not a directory"* — but
the network-payload attack was not run.
### MB-GOD-033 - EXIF GPS does not survive an upload (behavioural, mutation-tested)

| Field | Value |
| --- | --- |
| **Surface** | Profile media, all image uploads |
| **Severity** | n/a - **verification, no defect found** |
| **Category** | Privacy |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 6) |
| **Status** | **VERIFIED** |

The highest-stakes property in this domain. Mad Buddy exposes proximity **bands**
rather than distances and stores **no coordinates** for Safe Arrival — a photo
carrying GPS EXIF would walk straight past all of it, because the image is
downloadable and the metadata survives the browser.

`lib/media/processing.ts` documents that re-encoding through sharp without
`withMetadata()` drops every metadata block. **This does not take that on trust.**
`lib/media/exif-stripping.test.ts` builds a JPEG carrying real GPS EXIF (the
Accra fixture coordinates used elsewhere in this program), runs the product's own
`processImageUpload`, and reads the output back.

```
PASS  the fixture really does carry GPS, so this test can fail
PASS  strips GPS EXIF from the stored image
PASS  strips metadata from every variant, not only the original
PASS  keeps the image itself intact while dropping the metadata
```

The first assertion is deliberate: without it, "no GPS in the output" would be
satisfied by an input that never had any — the empty-fixture trap this program
has already been caught by once.

The **variant** assertion matters as much as the original: a variant is what
actually gets served to other people, so stripping the original while shipping a
thumbnail that still carried GPS would defeat the entire point.

**Mutation-tested.** Re-enabling `withMetadata()` on the encode pipeline fails
**two** tests, and the failure message shows the leaked bytes themselves —
`Buffer[ 69, 120, 105, 102, … ]`, which is ASCII `Exif`:

```
× EXIF survived processing
× EXIF survived in the thumb variant
```

Also confirmed by reading the implementation: processing happens **before any
byte reaches storage**, so no window exists in which GPS data is at rest.

### MB-GOD-034 - Profile media lifecycle: 10/10, domain 6 COMPLETE

| Field | Value |
| --- | --- |
| **Surface** | Profile media / showcase |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - Extremely Advanced (domain 6) |
| **Status** | **VERIFIED — domain COMPLETE** |

```
PASS  three showcase photos occupy positions 0,1,2
PASS  a fourth slot (position 3) is refused by the database
PASS  two photos cannot occupy the same slot
PASS  replacing a slot swaps the reference without losing the slot
PASS  a failed retirement leaves an ORPHAN asset, not a broken slot
PASS  a stale delete keyed on the OLD asset does not remove the new image
PASS  the owner sees all three photos
PASS  an approved Muddy sees everyone + approved_muddies, never only_me
PASS  a stranger sees only the `everyone` photo
PASS  a stranger querying the table directly cannot read private slots
```

**The capacity limit is enforced by the SCHEMA, not by hiding a button:**

```sql
profile_photos:
  CHECK (position >= -1 AND position <= 2)   -- 3 showcase slots, -1 = avatar
  UNIQUE (user_id, position)                 -- no two photos in one slot
  CHECK (visibility IN ('everyone','approved_muddies','only_me'))
```

A direct authenticated insert at `position: 3` is **refused by the database**, and
so is a duplicate position. That is the difference between a limit and a
suggestion.

**Replacement durability.** The canonical order is upload new → swap reference →
retire old. Modelling "retirement failed" (swap succeeds, old asset survives)
leaves an **orphan asset** but an **intact slot** — the user's showcase is never
broken by a failed cleanup. `media_deletion_queue` exists as the cleanup
infrastructure, so orphans are tracked rather than abandoned.

**Concurrency (domain 6 multi-tab).** Tab A believes slot 1 holds asset B; Tab B
has already replaced it with D. Tab A's delete, keyed on the **old asset id**,
removes **0 rows** and D survives. Had the delete been keyed on *position* alone,
it would have destroyed someone else's newer image — that is the shape this test
exists to catch.

**Privacy is enforced at two layers, and both were checked.** The projection in
`loadVisibleProfilePhotosFor` narrows by viewer role, and the RLS policy narrows
the table itself: a stranger signed in under their own credentials reads **exactly
one row** — the `everyone` photo — with zero private slots among them. A
projection alone would be decoration if the row were readable directly.

The implementation's own reasoning on URLs is worth preserving: thumbnails are
signed **short-lived** rather than permanent, because *"a permanent URL would
outlive the setting that allowed it, so switching a photo to `only_me` could not
take back a link already handed out."*

**One harness correction:** `moderation_status: "approved"` is not in the enum
(the values are `active`, `under_review`, `restricted`, `removed`, `restored`,
`deleted_by_user`). The probe reported INCONCLUSIVE rather than passing.

**Carried forward, stated rather than claimed:**
- **Signed-URL residual exposure after a block.** A short-lived URL already
  handed out remains valid until it expires; revocation is not instantaneous by
  construction. The design mitigates this by keeping the window short, but the
  exact expiry window and its acceptability were not measured.
- **Invalid-media handling** (spoofed MIME, oversized, zero-byte, malformed) —
  `lib/media/validation.ts` exists and is typed, but the failure paths were not
  exercised end to end.
- **Cache behaviour across account switches**, which matters more for the later
  Capacitor transition than for web.
## MISSION 1 — God Mode: the four remaining detail surfaces

### MB-GOD-035 - Detail surfaces crawled: Conversation, Plan detail, Plan Chat, Event detail

| Field | Value |
| --- | --- |
| **Surface** | Conversation, Plan detail, Plan Chat, Event detail |
| **Severity** | n/a - **verification, no defect found** |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **VERIFIED** |

All four are reached by query parameter over a list surface
(`?conversation=`, `?plan=`, `?event=`), so crawling them needed **real ids of
each kind**. `scripts/hardening/seed-detail-surfaces.mjs` creates a direct
conversation with messages, a Plan with accepted participants (which yields a
distinct Plan Chat), and a live public Event with RSVPs — crawling `?conversation=`
with no conversation would have exercised the empty state and proven nothing.

```
nodes 7   edges 52
outcomes: inline 19, overlay 9, nav 6, dead 4, error 14
```

**Zero wrong destinations. Zero real dead controls.**

**Every "dead" result was investigated individually and none was a defect:**

| Control | Verdict |
| --- | --- |
| "Created by you" (Plan detail) | already-active tab — clicking the current tab correctly does nothing |
| "Hosting" (Event detail) | already-active tab |
| "Back to conversations" ×2 | **works correctly** — verified by hand: navigates `?conversation=<id>` → `/messages` and the content changes |

The "Back to conversations" result is a **crawler artifact worth recording**: the
crawl presses Escape between controls to dismiss whatever the previous one
opened, and on `/messages?conversation=<id>` that Escape *also closes the
conversation panel* — so the subsequent Back click has nothing left to go back
from. The caveat is now documented in `state-graph.mjs`: detail-surface findings
must be confirmed individually rather than read straight off the crawl.

**One destination was checked because it looked wrong and was not.** The graph
recorded `Add Muddy → /friends?tab=requests`, which would be a semantic defect —
"Add" should open search, not the requests tab. Verified by hand: the control
opens a **dialog with a search field** and stays on `/friends`. The `?tab=requests`
in the graph was residue from a preceding edge, not this control's destination.

**The console 404s did not reproduce.** Loading each detail surface cleanly, and
then interacting, produced **no 404 at all**. The errors recorded during the crawl
came from traversing *through* Linkr during edge-walking — the documented orb
probe (MB-GOD-006) — not from the detail surfaces.

### Full state graph, after the detail crawl

```
core surfaces (13)   34 nodes   193 edges   0 destination mismatches
detail surfaces (4)   7 nodes    52 edges   0 destination mismatches
                     ----------------------------------------------
TOTAL                41 nodes   245 edges
```

**Graph analysis against the checklist:**

| Check | Result |
| --- | --- |
| dead-end states | none — every crawled surface offers navigation out |
| wrong detail destination | none across 245 edges |
| wrong-user destination | none — the Muddy modal was separately proven to open the correct person (MB-GOD-005 follow-up) |
| accidental Home fallback | none observed |
| circular navigation | none — no edge returned to its origin except correct self-links, classified `self` |
| orphan route | `/hangout-mode` (MB-GOD-007, owner-blocked); `/dev/*` correctly 307s in production |
| orphan tour target | none — `profile-privacy` was re-anchored when Profile was restructured (MB-GOD-013) |
| legacy route leakage | `/hangout-mode` only, tracked |
| modal/sheet trap | none — every overlay closed on Escape, which is how the crawl proceeds at all |
| unreachable management action | none found; every Settings destination verified reachable (MB-GOD-013) |

**Honest limits of this graph.** It covers reachable UI controls on 17 surfaces
under one signed-in account with geolocation granted and tours dismissed. It does
**not** cover: multiple concurrent account states, permission-denied variants
beyond geolocation, or surfaces only reachable from a notification deep link. The
crawl is evidence about this account's reachable graph, not a proof of total
reachability.
### MB-GOD-036 - Live Event attendee-enumeration attack: no leak (carried item CLOSED)

| Field | Value |
| --- | --- |
| **Surface** | Events, Event Linkr |
| **Severity** | n/a - **security verification, no defect found** |
| **Category** | Privacy / enumeration |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **CLOSED** |

The data contract was already proven (`eventLinkrCandidateIds` returns ids only,
and only of consenting attendees). What had never been run is the **network**
attack: what an actual HTTP response hands an actual viewer. *"The UI does not
show it"* is not privacy proof.

Seeded so a leak would be **visible** — attendees in three deliberately different
states, because an empty attendee list cannot demonstrate the absence of a
directory:

```
KOFI   checked in + consenting
AMA    checked in, NO consent      ← the sharpest case
JOJO   going, never checked in
```

Then every HTTP response body on `/events`, `/events?event=<id>` and
`/events/<id>` was harvested, plus direct calls to `/api/events/<id>`,
`/api/events/<id>/attendees` and `/api/events?event=<id>`, and searched for each
attendee's user id.

```
PASS  the probe actually captured payloads (not an empty run)   host saw 132 payloads
PASS  a signed-out visitor receives NO attendee identifiers      99 payloads, none leaked
PASS  an unrelated authenticated user receives NO identifiers   133 payloads, none leaked
PASS  the non-consenting attendee never appears in ANY payload   absent everywhere
```

**364 payloads inspected across three viewer types. Zero attendee identifiers.**

The first assertion exists so the run cannot pass by capturing nothing — the
empty-fixture trap this program has been caught by before.

The AMA case is the one that matters most: someone who **checked in but did not
consent** is invisible to every viewer. Presence does not become discoverability
at the payload layer either, not merely in the eligibility function.

### MB-GOD-037 - Signed-URL residual exposure: measured and bounded (carried item CLOSED)

| Field | Value |
| --- | --- |
| **Surface** | Profile media, all private media |
| **Severity** | **P3 — accepted, documented limitation** |
| **Category** | Privacy / capability lifetime |
| **Mission / Level** | Mission 1 - God Mode |
| **Status** | **MEASURED — accepted by design** |

The question carried from domain 6: if A legitimately holds a signed media URL
and B then blocks them, what happens?

**The window is exactly 5 minutes.**

```ts
/** One lifetime for every private media URL minted by Mad Buddy. */
export const MEDIA_SIGNED_URL_TTL_SECONDS = 5 * 60;
```

Two properties, and they are **different security claims** that must not be
conflated:

| Property | Status |
| --- | --- |
| **New access is prevented immediately** | ✅ Yes. The next projection excludes the photo — `loadVisibleProfilePhotosFor` re-queries by viewer role every time, and no new URL is minted. |
| **A previously issued capability stays valid until it expires** | ⚠️ Yes, for **≤ 5 minutes**. This is inherent to time-bound signed URLs and is not fixable by application code. |

**What remains exposed, precisely:** only media the viewer had **already
legitimately obtained** a URL for, only for the remainder of that URL's ≤5-minute
lifetime, and only the specific variant already signed. No new media, no other
slots, no re-signing — `signMediaForAsset` would be asked again and would decline.

**Why this is the right trade, and the code says so.** The implementation
deliberately chose short-lived signatures over permanent URLs for exactly this
reason:

> *"Signed and short-lived rather than permanent: a permanent URL would outlive
> the setting that allowed it, so switching a photo to `only_me` could not take
> back a link already handed out."*

The alternative — permanent URLs — would make the residual window **infinite**.
The alternative to *that* — proxying every image through an authorising route —
trades a bounded 5-minute window for a per-request auth check on every thumbnail,
which is a real cost for a small marginal gain against a viewer who could simply
have saved the image.

**Additional revocation that IS immediate**, regardless of TTL: `signMediaForAsset`
refuses to sign at all when the asset is soft-deleted (`deleted_at`) or its
`moderation_status` is `removed`/`restricted` — *"whatever the parent says"*. So
moderation and deletion take effect on the next request, not after 5 minutes.

**Recorded as an accepted limitation rather than a defect.** It is a property of
time-bound capabilities, the window is small and bounded, the exposure is limited
to already-obtained media, and the design comment shows it was a considered
choice. A future mitigation, if ever wanted, would be shortening the TTL for
photos whose visibility is narrower than `everyone`.
---

# MISSION 1 — PRODUCT CORRECTNESS / RELIABILITY: CLOSEOUT

```
ADVANCED              COMPLETE
EXTREMELY ADVANCED    COMPLETE
GOD MODE              COMPLETE
```

**The first full mission closure of the program.**

## Major defects found and fixed

| ID | Sev | What it was |
| --- | --- | --- |
| MB-GOD-003 | **P0** | `/login` and `/signup` put **passwords in the URL** when JavaScript had not run — a form with no `method` defaults to GET. Verified in the server access log. |
| MB-GOD-010 | **P0** | `/admin/login` had the **same defect**, missed because the first fix was scoped to `components/auth/` rather than to the defect's shape. Eight forms carried it. |
| MB-GOD-020 | **P1** | The **account data export returned 500 for every user, always** — it selected `profiles.onboarding_complete`, a column that does not exist. The route also discarded the Postgres error, so it was undiagnosable. |
| MB-GOD-002 | **P1** | App-wide hydration warning, root-caused to **CSP nonce-hiding** (a browser behaviour) rather than suppressed broadly. |
| MB-GOD-001 | P2 | Test-worker starvation from repeated synchronous source-tree parsing. Suite **147s → 72s**. |
| MB-GOD-005 | P2 | **Nine tab rows at four different heights**, all under the 44px minimum. ~30 targets fixed. |
| MB-GOD-013 | P2 | **Profile was an account dashboard**: 3.97 screens, 28.6% settings, Showcase at 3.7%. Restructured to 2.40 screens, 0% settings, identity 29% → 48%. |
| MB-GOD-022 | P2 | Six API routes returned 5xx while **discarding the cause**. All 67 routes now log it. |
| MB-GOD-016 | P3 | Back-link touch target, in two files from one copied class string. |

**P0 history: 2 discovered, 2 fixed, 0 open.** Both were the same defect class,
and the second existed *because* the first was fixed instance-by-instance. That
lesson produced `lib/security/form-method-guard.ts`, which is mutation-tested.

## Lifecycle proof — 7/7 domains

| # | Domain | Coverage | Multi-tab |
| --- | --- | --- | --- |
| 1 | Muddy relationship | 7/7 | 5 |
| 2 | Linkr | 7/7 | 0 |
| 3 | UpFor → Plan | 7/7 | 0 |
| 4 | Plan RSVP / membership | 10/10 | 1 |
| 5 | Event check-in / Event Linkr | 8/8 + 12/12 + 9/9 | 1 |
| 6 | Profile media | 10/10 + EXIF 4/4 | 1 |
| 7 | Safe Arrival + Messages | 5/5 + 8/8 | 1 |

Every domain verified at the **server/database boundary**, not the UI.

## State graph

```
core surfaces (13)    34 nodes   193 edges
detail surfaces (4)    7 nodes    52 edges
                      -------------------------
TOTAL                 41 nodes   245 edges

0 wrong destinations   0 real dead controls
```

## Concurrency proof

Nine multi-tab scenarios across five domains. The results that matter:

- Two simultaneous friend requests → **200/400, one row**
- Two simultaneous UpFor→Plan conversions with one key → **both ok, one Plan**
  (the second waits on `for update` and returns the first's Plan)
- Same `client_message_id` twice → **one message** (unique index, not button timing)
- Stale slot delete keyed on the **old asset id** → 0 rows, newer image survives
- A removed member's still-open tab → **refused**

## Privacy proof

- **Linkr one-sided interest is invisible** — verified by reading as the *target*
  under RLS: zero rows, zero notifications
- **Event consent is not implied by presence** — behavioural, mutation-tested
- **No attendee enumeration** — 364 HTTP payloads across three viewer types, zero
  identifiers; the non-consenting attendee absent everywhere
- **EXIF GPS is stripped** — mutation-tested; re-enabling `withMetadata()` fails
  two tests and shows the leaked `Exif` bytes
- **Safe Arrival cannot leak a location structurally** — the schema has no
  latitude/longitude column at all
- **Profile media privacy holds at two layers** — projection *and* RLS
- **1081 select lists + 1165 filters** checked against generated types: 0 unknown
  columns, mutation-tested

## Known external / owner blocks

| ID | Status | Why it is blocked, not unexamined |
| --- | --- | --- |
| **MB-GOD-007** | OWNER-BLOCKED / READY FOR FUTURE MIGRATION | `/hangout-mode` → UpFor rename touches 37 files **including shipped migration rows**, notification destinations and the OAuth allow-list. Requires production data migration, which is the owner's call. Fully mapped; no code defect. |
| **MB-GOD-012** | FRAMEWORK-CONSTRAINED | `notFound()` inside the `(app)` group renders the correct 404 screen with **HTTP 200**, because the `force-dynamic` layout streams before the call is reached. A group-level `not-found.tsx` was tried and **reverted** — it did not help. Remedy is resolving existence before the stream opens: architectural, belongs with Mission 4. Impact: crawlers index it, monitoring misses it, caches treat it as valid. |
| **MB-GOD-037** | ACCEPTED LIMITATION | Signed media URLs remain valid ≤5 minutes after a block. New access is prevented immediately; a previously issued capability expires on its own. Inherent to time-bound capabilities. |

## Deferred polish (P3)

- **MB-GOD-006** — `/linkr/orb-off.png` 404s on every load. A deliberate probe for
  artwork that has not landed; the component falls back to a placeholder.
- **MB-GOD-008** — twelve consecutive tour overlays for a new user. Each is fine
  individually; the cumulative first-run effect is a Mission 3 question.
- 44 eslint `no-unused-vars` warnings — dead code, no correctness risk.

## Outstanding behavioural verification

**Linkr block guard: STRUCTURAL = VERIFIED, BEHAVIOURAL = OUTSTANDING.**
The guard's presence, position and non-neutering are asserted and
mutation-tested (short-circuit and removal both caught). What is *not* proven is
that it works when invoked: `connectWithCandidate` is a **server action**, not an
API route, so driving it needs framework-level invocation the local harness
cannot perform. Testing the lower-level RPC instead would be fake proof — that
primitive deliberately has no block check.

## Final gate

| Gate | Status |
| --- | --- |
| 4 remaining detail surfaces crawled | ✅ |
| Full graph analysed | ✅ 245 edges |
| No unresolved P0 | ✅ 0 |
| No unresolved P1 | ✅ 0 |
| P2 fixed or explicitly blocked | ✅ 4 fixed, 4 owner/framework-blocked |
| Linkr block guard resolved or documented | ✅ precisely documented |
| Live Event enumeration attack | ✅ closed, no leak |
| Signed-URL residual measured | ✅ 5 minutes, bounded |
| DB contract audit clean | ✅ mutation-tested |
| 5xx observability clean | ✅ 67/67 |
| 7/7 lifecycle domains green | ✅ |

**MISSION 1 = COMPLETE.**

