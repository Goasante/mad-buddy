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
