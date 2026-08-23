# God Mode hardening — continuation report

**Written at the end of session 21.** The next session continues from here.

```
WORKTREE     C:\mb-god
BRANCH       hardening/god-mode-product-pass
HEAD         (see foot of file)
ORIGIN/MAIN  3a42cc06e1506682595de544ca335abc3c110749  (unchanged, nothing pushed)
STATUS       clean
COMMITS      84 local recovery checkpoints, none pushed, nothing deployed
```

## Where the program is

| Mission | Level | State |
| --- | --- | --- |
| 1 — Reliability | Advanced | **COMPLETE** (route audit, auth, control inventory, mutation & journey audit, hydration, test infra, pre-hydration form audit) |
| 1 — Reliability | Extremely Advanced | **COMPLETE (7/7 domains)** | **PARTIAL — 3/7 domains** (corrected in MB-GOD-027; previously mis-reported as 5/7). See the canonical domain table below. |
| 1 — Reliability | God Mode | **COMPLETE** — 41 nodes / 245 edges / 0 wrong destinations; both carried security items closed |
| 2 — UI/UX | Advanced | **COMPLETE — 18/18 surfaces.** Verdicts: 14 GOOD, 4 GOOD WITH MINOR DEBT, 0 structural, 0 rebuild. Profile was the one structural problem and is fixed (MB-GOD-013). |
| 2 — UI/UX | Extremely Advanced | **COMPLETE.** Task cost 20/20 goals measured (max 3 taps); 12 empty states, 0 defects; failure states under offline/500; 5 cross-feature handoffs; accessibility depth. 4 findings: MB-GOD-040 and 043 FIXED, MB-GOD-041 and 042 recorded OPEN with reproductions. |
| 2 — UI/UX | God Mode | **COMPLETE.** MB-GOD-041 and 042 closed; hover-only class closed; vocabulary, component/typography/icon grammar, focus system, theme parity, state colour, trust expression and the visual board all audited. 200% text went 29/60 broken → 0/60. |
| **2 — UI/UX** | **ALL THREE LEVELS** | **COMPLETE — closeout written in the audit ledger** |
| 3 — Journeys | Advanced | **COMPLETE — 20/24 audited experientially, 4 resting on Mission 1 lifecycle proof.** 4 findings: MB-GOD-049 and 050 FIXED, 051 classified, 052 open. |
| 3 — Journeys | Extremely Advanced | **COMPLETE.** UpFor momentum 7/7 and conversion 6/6 with three live people; stale/expiry/offline 6/6; permissions 10/10; Home matrix 4/4. Findings: P0=0 P1=0 P2=1 (fixed) P3=0. |
| 3 — Journeys | God Mode | **COMPLETE.** P0-P3 = 0 findings. Produced the activation lifecycle, network-effect map, density thresholds, success ladder, notification/permission models and the Linkr root cause. |
| **3 — Journeys** | **ALL THREE LEVELS** | **COMPLETE — closeout written in the audit ledger** |
| 4 — Information architecture | Advanced | **COMPLETE.** 22 surfaces mapped, 13 data authorities, 6/6 deep links, nav 5/5. Findings: P0-P1=0, P2=1 (MB-GOD-053 open). Profile lock preserved. |
| 4 — Information architecture | Extreme / God Mode | not started |
| 5 — Mobile shell / safe area | Advanced | **complete — no root-cause defect** (MB-GOD-009) |
| 5 — Mobile shell | Extremely Advanced | not started (keyboard, landscape, PWA/Capacitor, sheets/modals/camera) |
| 6 — Security / privacy | — | early evidence gathered (privacy probe passes meaningfully); full pass not started |
| 7 — Landing page | — | not started |
| 8 — Cross-product consistency | — | not started; 44 dead-code eslint warnings waiting |
| FINAL — convergence | — | not started |

## Canonical lifecycle domains (the ONLY valid denominator)

Corrected in MB-GOD-027. Sessions 5-7 reported 5/7 by counting multi-tab (a
cross-cutting technique, not a domain) and by counting Safe Arrival+Messages
complete while Messages had no coverage. No evidence was altered — only the
arithmetic over it.

| # | Canonical domain | Status | Valid sequence coverage | Multi-tab coverage |
| --- | --- | --- | --- | --- |
| 1 | Muddy relationship | **COMPLETE** | 7/7 (MB-GOD-017) | Yes (5 scenarios, MB-GOD-018) |
| 2 | Linkr | **COMPLETE** | 7/7 (MB-GOD-024) | No |
| 3 | UpFor → Plan | **COMPLETE** | 7/7 (MB-GOD-023) | No |
| 4 | Plan RSVP / membership | **COMPLETE** | 10/10 (MB-GOD-029) — RSVP cycle, add participant, Plan Chat reconciliation, outsider exclusion | Yes (1: stale RSVP replay) |
| 5 | Event check-in / Event Linkr | **COMPLETE** | Consent 8/8 (MB-GOD-028) + audiences 12/12 (MB-GOD-031) + wiring 9/9 (MB-GOD-032) | Yes (1: stale eligibility) |
| 6 | Profile media | **COMPLETE** | 10/10 (MB-GOD-034) + EXIF 4/4 mutation-tested (MB-GOD-033) | Yes (1: stale slot delete) |
| 7 | Safe Arrival + Messages | **COMPLETE** | Safe Arrival 5/5 (MB-GOD-026) + Messages 8/8 (MB-GOD-030) | Yes (1: stale membership send) |

**LIFECYCLES COMPLETE = 7 / 7 — MISSION 1 EXTREME COMPLETE.** Multi-tab by domain: Muddy 5, Plan 1, Event 1, Profile 1, Messages 1 (9 total, five domains). Domains 2 (Linkr) and 3 (UpFor) have no stale-state coverage.

Report these four columns per domain at every checkpoint. A bare fraction is what
let two independent errors hide inside one number.

## POST-GOD-MODE ROADMAP (recorded, NOT to be implemented yet)

Owner-defined phase order after the hardening program completes:

```
GOD MODE MISSIONS 1-8
  ↓
MISSION 9 — SCALE / PERFORMANCE / COST GOD MODE
  ↓
FINAL CONVERGENCE
  ↓
MONETIZATION RESET
  ↓
SMALL FINAL CLEANUP
  ↓
NATIVE READINESS AUDIT
  ↓
ANDROID + IOS / CAPACITOR
```

**Mission 9 scope** (recorded, NOT to be started yet): Vercel Fluid CPU,
invocations, requests per DAU, Supabase query/load profile, Realtime, Storage,
cache behaviour, polling, N+1, cron/background work, bot amplification, usage
modelling at 100 / 500 / 1k / 5k / 10k / 50k / 100k / 500k, provider escape
strategy, and infrastructure cost per active user.

**Do not begin monetization work during a Mission 1 session.** Recorded here so
it is not lost, and so no hardening change accidentally forecloses it.

### Monetization target (future scope — design constraints only)

Current: Free / Plus / Pro feature-tier architecture.

Target:
- **Core Mad Buddy is FREE.**
- **Linkr + UpFor become a paid access entitlement.**
- New users get roughly **30 days complimentary access, no card required**, after
  genuine activation.
- After that, core stays free; Linkr + UpFor lock unless a valid entitlement
  exists.

**Must never become hostage to payment:** Muddies, Messages, Plans, existing
Linkr conversations, Safe Arrival, core Glow/proximity. This constraint matters
to hardening work too — it means the entitlement boundary must sit around
*discovery*, never around existing relationships or safety.

Staff/admin/support get an internal bypass by role.

Admin entitlement architecture must eventually support: individual grant, extend,
revoke, custom duration; and global +1 month, global free period, global 1 year,
global until revoked, early global revoke.

**Global access must be a resolver-level override, NOT a mass update of every
user row.** (Consistent with the existing "one backend authority per lifecycle"
rule, and with how feature flags already fail closed from a single row.)

## Environment setup for the next session

The production runtime is the target. Dev mode only for debugging a specific
defect, and any dev-mode fix must be re-verified against a rebuild.

```bash
cd C:\mb-god
docker ps                                     # local Supabase must be up
npm ci                                        # if node_modules is absent
npm install --no-save playwright@1.62.1       # harness, not a project dep

# .env.local must point at 127.0.0.1 — CHECK THIS EVERY RUN, it has reverted before
grep SUPABASE_URL .env.local

docker exec -i supabase_db_mad-buddy psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < scripts/hardening/local-db-grants.sql
node scripts/hardening/seed-local.mjs
node scripts/hardening/seed-proximity.mjs
npm run build && npx next start -p 3200
node scripts/hardening/login.mjs
node scripts/hardening/dismiss-tours.mjs
```

`scripts/hardening/README.md` documents every tool and the order of operations.
Prefix commands with `MSYS_NO_PATHCONV=1` in Git Bash.

## Verified baselines to compare against

```
TESTS       6861 / 6861   (339 files)
TSC         PASS
ESLINT      0 errors, 44 warnings (all no-unused-vars dead code)
BUILD       PASS
DIFF CHECK  CLEAN
CRAWL       13/13 authenticated surfaces clean at 393x852
VIEWPORTS   no horizontal overflow at 360/375/390/393/430, light and dark
JOURNEYS    10/10   LIFECYCLE 7/7   MULTI-TAB 5/5   STATE GRAPH 193 edges
```

## Open items, in the order they should be picked up

0. ~~MB-GOD-013 — Profile restructuring~~ **DONE in session 4.** 3.97 -> 2.40
   screens, settings/support 28.6% -> 0%, identity 29.1% -> 48.1%, bio moved
   from y=2227 to y=1267. All 7 moved destinations verified reachable at runtime.
0b. **MB-GOD-012 — `notFound()` inside `(app)` returns HTTP 200** (P2). Framework
   constraint, not app code: the `force-dynamic` layout streams before the call
   is reached. A group-level `not-found.tsx` was tried and did NOT fix it
   (reverted). Real remedy is resolving existence before the stream opens —
   architectural, belongs with Mission 4.
0c. **Lifecycle sequences still UNTESTED end-to-end.** The `request → cancel →
   resend` probe hit a 400 (the API correctly refuses a raw id without a prior
   search — an anti-enumeration guard) and so exercised nothing. Needs a fixture
   that goes through the real search flow.

1. **MB-GOD-007 — UpFor is served from `/hangout-mode`** (P2, Mission 4).
   The product says UpFor everywhere; the URL says hangout-mode. Deferred here
   because renaming touches deep links, notification destinations and invite
   links, so the redirect strategy belongs with the IA pass.
2. **MB-GOD-008 — twelve consecutive tour overlays** (P3, Mission 3).
   Each is individually fine; the cumulative first-run effect is the question.
   Judge it in the first-10-minutes simulation.
3. **MB-GOD-006 — `/linkr/orb-off.png` 404 on every load** (P3, Mission 6).
   A deliberate probe for artwork that has not landed. Either the art arrives or
   the probe moves to a method that fails quietly; the console noise will mask
   real errors in production logs.
4. **GoogleAnalytics nonce** (Mission 6). The third nonce'd script renders only
   in production and is third-party, so `suppressHydrationWarning` cannot be
   passed to it. Re-check hydration against a production build before release.
5. **44 eslint dead-code warnings** (Mission 8). Not correctness risks, but they
   are abandoned implementation — squarely design debt.
6. **Mission 5 Extremely Advanced**: keyboard-open composer, landscape,
   installed PWA / Capacitor standalone, and safe-area INSIDE sheets, modals,
   the photo viewer and the camera. None of these are covered yet.

## MISSION 2 ADVANCED IS COMPLETE — 18/18 surfaces

Verdicts: **14 GOOD, 4 GOOD WITH MINOR DEBT, 0 structural problems, 0 rebuilds.**
Profile was the single structural problem and it is fixed (MB-GOD-013).

Full detail in MB-GOD-038/039 at the end of `god-mode-audit.md`.

**Next: MISSION 2 EXTREMELY ADVANCED.** That level asks a different question from
Advanced — not "is this screen well built?" but:
- interaction cost (how many taps for the frequent jobs?)
- cognitive load (how much must be read before acting?)
- progressive disclosure (what could appear only when relevant?)
- cross-feature transitions (does finishing one thing lead to the next?)
- empty / loading / error quality as product, not placeholder
- motion, micro-interactions, platform feel
- accessibility depth (screen reader, focus order, reduced motion)

Do not rush it because Advanced closed. It is the level where the Profile-style
structural insight actually comes from.

**Minor debt carried from Advanced** (not urgent, do not batch-fix blindly):
- Landing is 9.46 screens with eight parallel feature headings — Mission 7 owns it
- Footer links ~19px — inline prose exception, but a footer is where they are
  hardest to hit
- Per-message actions (React / Edit / Delete) measure ~17px tall; not yet
  established whether they sit inside a menu, which would make that acceptable

## 🏁 MISSION 1 IS COMPLETE (Advanced + Extremely Advanced + God Mode)

The first full mission closure. Full closeout is at the end of
`docs/product/god-mode-audit.md` — defects, lifecycle proof, graph size,
concurrency proof, privacy proof, owner/framework blocks and the final gate.

Headline: **2 P0 and 2 P1 found and fixed, 0 open.** 7/7 lifecycle domains,
245 graph edges with 0 wrong destinations, 364 HTTP payloads with 0 attendee
leakage.

Three items remain OPEN by classification rather than neglect:
- **MB-GOD-007** owner-blocked (production data migration)
- **MB-GOD-012** framework-constrained (streamed 404 → HTTP 200)
- **Linkr block guard** structural verified, behavioural outstanding (server
  action cannot be invoked from the local harness)

**Next: Mission 2 Advanced — 8 of 18 surfaces remain.** Landing, Auth,
Activation, Conversation, Plan detail, Plan Chat, Event detail, Safe Arrival.
Profile IA is LOCKED; do not reopen it.

## MILESTONE — MISSION 1 EXTREMELY ADVANCED IS COMPLETE

All seven canonical lifecycle domains are closed, each verified against the
server/database boundary rather than the UI:

| # | Domain | Coverage | Multi-tab |
| --- | --- | --- | --- |
| 1 | Muddy relationship | 7/7 | 5 |
| 2 | Linkr | 7/7 | 0 |
| 3 | UpFor → Plan | 7/7 | 0 |
| 4 | Plan RSVP / membership | 10/10 | 1 |
| 5 | Event check-in / Event Linkr | 8/8 + 12/12 + 9/9 | 1 |
| 6 | Profile media | 10/10 + EXIF 4/4 | 1 |
| 7 | Safe Arrival + Messages | 5/5 + 8/8 | 1 |

Exit gate, checked honestly:
- 7/7 domains complete, none partial-disguised-as-complete
- stale-state coverage in five of seven domains (Linkr and UpFor have none)
- no setup failure counted as PASS — every one reported INCONCLUSIVE and fixed
- no empty-fixture privacy proof — each was seeded so it could fail
- public authorities tested, not the deepest callable primitive
- critical privacy invariants verified at the real layer (RLS, schema, sharp)

**Two items are carried forward rather than counted as done:**
- Linkr behavioural block guard — structural guard verified and mutation-tested;
  server-action invocation still OUTSTANDING.
- Live Event attendee-enumeration HTTP attack — the data contract is proven;
  the network attack is a God Mode/security item, not a lifecycle gap.

## Next session: Mission 1 God Mode

**Domain 6 — Profile media** is the last untouched lifecycle. Everything needed
is specified below; nothing else blocks Mission 1 Extreme from closing.

**Domain 5 is now COMPLETE** (MB-GOD-031 audiences 12/12, MB-GOD-032 wiring 9/9).
Do not re-run it. The one piece deliberately carried forward is attendee
enumeration against live HTTP payloads with a large seeded attendee set — the
data contract is proven, the network attack was not run.

## Superseded: the two remaining domains

**Domain 6 — Profile media (NOT STARTED)** is the larger piece. It needs real
storage + DB work, not a UI test:
- add / replace / reorder / visibility / remove, verifying DB *and* storage
  object state after each
- the replacement invariant: upload new → confirm ready → DB swap → retire old.
  Never delete-then-upload, or a failed replacement destroys working media
- failure injection: upload ok / DB swap fails; DB ok / refresh fails; duplicate
  replace; stale slot id
- capacity stays **3 showcase images** — do not expand it
- visibility as self / approved Muddy / Linkr stranger / blocked / unrelated,
  tested against the real storage path (a URL that is not rendered is still a URL
  that can be fetched)
- one multi-tab: Tab A holds stale slots, Tab B reorders, Tab A submits

**Domain 5 — Event check-in / Event Linkr (PARTIAL)** needs the wiring, not the
rules. The consent decision is proven (MB-GOD-028, mutation-tested); what remains
is that the system actually recomputes from changed state:
- checkout / opt-out / Event end → next candidate computation excludes the user
- attendee enumeration against live payloads, with enough seeded attendees that a
  leak would be visible
- the five audience authorities: invite / link / community / nearby / public

## Things the next session should not re-derive

- **Event revocation is immediate because nothing is cached** (MB-GOD-032):
  `resolveEventLinkrEligibility` reads liveness → check-in → consent live on every
  call. There is no eligibility column to go stale.
- **Four separate flags, four separate meanings**: `event_rsvps.status='going'`
  (intent), `check_ins.status='checked_in'` (presence),
  `event_linkr_opt_ins.enabled` (consent), `check_ins.event_glow_enabled`
  (Glow — NOT consent). Do not conflate any two.
- **`link` Events are viewable but NOT discoverable** (MB-GOD-031). That gap is
  the point of an unlisted audience; do not "simplify" the two authorities into one.
- **The Event/Linkr seam fails closed** and Linkr re-derives no consent. Do not
  move consent logic into `candidate-service.ts`.
- **Real schema notes**: Event status enum is
  `draft|scheduled|active|ended|cancelled` (NOT `published`); check-in lives in
  `check_ins` (context_type/context_id), not `event_rsvps`.

- **Messages idempotency is a DATABASE guarantee** (MB-GOD-030): unique index on
  `(sender_id, client_message_id)`. Do not "improve" it with client-side debounce.
- **Plan Chat membership follows RSVP, not invitation** (MB-GOD-029). An invitee
  who has not accepted is correctly absent from the chat.
- **Conversations link to Plans via `context_type`/`context_id`**, NOT a `plan_id`
  column. Querying `plan_id` returns nothing and looks like a missing chat.
- **Valid `system_event_type` values** are the 14 in the check constraint;
  `plan_created` is NOT one of them (`plan_confirmed` is).
- **Event Linkr consent is proven** (MB-GOD-028), behaviourally and
  mutation-tested: attendance does not imply discoverability, a block beats Event
  eligibility, and revocation is immediate with no grace window. Do NOT re-derive
  the decision rules — `isCandidateEligible` is the single authority and it is a
  pure function, so it can be tested directly.
- **What Event Linkr still needs**: the checkout → `eventEligible` recompute
  wiring driven end to end, attendee-directory enumeration against live payloads,
  and the five audience authorities (invite / link / community / nearby / public).
- **The lifecycle denominator is 7 and the count is domain-based** (MB-GOD-027).
  Multi-tab is a technique, not a domain. Safe Arrival + Messages is ONE domain.

- **Linkr's one-sided privacy holds** (MB-GOD-024). Verified by reading as the
  TARGET under RLS: zero rows, zero notifications.
- **`linkr_record_connect` performs no block check, and that is CORRECT.** It is
  reciprocity-only. The block guard lives in `connectWithCandidate`
  (connection-service.ts:116), runs before the RPC, and returns a result
  indistinguishable from an ordinary Connect so it cannot be used as a block
  detector. Do not "fix" the RPC. A probe that calls it directly bypasses the
  authorization layer and will look like a P0.
- **`passCandidate` deliberately has no block check** — passing creates nothing
  and reveals nothing. The asymmetry with Connect is intentional.
- **Safe Arrival cannot leak a location structurally**: `safe_arrival_sessions`
  has NO latitude/longitude/geohash/accuracy column. The destination is a text
  label. A leak would require a schema change.
- **`lib/linkr/connect-block-guard.test.ts` is source-level only.** It proves the
  check is present, ordered and not short-circuited — NOT that it works. A
  behavioural test needs the server action driven through the framework; that is
  the stronger version and is still outstanding.

- **MB-GOD-020's defect class does NOT recur** (MB-GOD-021). 1081 select lists and
  1165 filters checked against the generated types: zero unknown columns.
  `scripts/hardening/db-contract.mjs` is mutation-tested — it catches the original
  bug — so "clean" is trustworthy. Re-run it after any schema change.
- **All 67 API routes now log the cause of a 5xx** (MB-GOD-022).
  `scripts/hardening/error-observability.mjs` is the regression check.
- **UpFor → Plan is safe under concurrency** (MB-GOD-023). Two simultaneous
  conversions with the same key both return ok and produce ONE Plan; the second
  waits on `for update` and observes `converted_plan_id`.
- **Real signatures**, so the next session does not rediscover them:
  `create_plan_lifecycle` takes **18** params and needs a **UUID** `p_request_key`
  and a `p_plan_type` of quick/scheduled/poll;
  `set_plan_participant_rsvp(p_actor_id, p_plan_id, p_status)` has **no**
  `p_user_id` (a participant sets their own RSVP — enforced by the signature);
  `hangout_sessions.activity_type` (not `activity`), `audience_type` must be
  `all_muddies`; `hangout_requests.hangout_session_id` + `requester_id`.
- **Two tables are absent from the generated types** and so are skipped by the
  contract check: `account_deletion_requests`, `user_phone_identities`. They exist
  in the database.

- **The state-graph crawler lied three times before it was trustworthy.** Fuzzy
  text → strict-mode violations. Index-based clicking → ten impossible
  "destination mismatches" (in-page querySelectorAll order does NOT match
  Playwright locator order). Denied geolocation → "Turn on Glow" reported dead.
  It now selects by identity (href / exact accessible name), re-checks before
  clicking, scrolls into view, and grants geolocation. **Do not revert to index
  selection.**
- **The nine "dead" controls in the graph are already-active tabs.** Clicking the
  tab you are on correctly does nothing. Left reported rather than suppressed
  because silencing it generically could hide a genuinely dead tab.
- **`accept_friend_request` denying service_role is correct** — it grants EXECUTE
  to `authenticated` only, so it runs as the real user under RLS. Call it as the
  signed-in receiver.
- **The friend-request and export endpoints are rate limited.** A prior run
  exhausts the quota and every later call returns 400/429, which then measures
  the limiter instead of the behaviour under test. Clear `rate_limits` in setup.
- **`profiles.onboarding_complete` does not exist; the column is `is_onboarded`.**

- **Profile's Privacy/Preferences/Support blocks were a DUPLICATE INDEX, not a
  home.** Every row only linked to a Settings destination Settings already listed.
  That is why removing them was safe. `/about` was the one exception and was added
  to Settings first.
- **`profile-privacy` tour target is now anchored to the hero's visibility pill.**
  A shipped migration row references it as a live tour step, so it must keep an
  anchor somewhere on `/profile`.
- **`scripts/hardening/profile-reachability.mjs` is the regression check** for the
  restructure: it fails if any moved destination stops being reachable.

- **Home's IA is good** (MB-GOD-014): 1 screen, adaptive, one clear job. Verified
  in ONE account state only — do not claim it adapts broadly without more fixtures.
- **Profile's IA is the problem** (MB-GOD-013): 3.97 screens, ~58% settings and
  support, Showcase at 3.7% while Support gets 17.6%. Measured, not guessed.
- **`/events/<missing>` and `/invite/<bad token>` returning 200 is CORRECT.**
  They are share/redirect pages that must not reveal whether a resource exists.
  Do not "fix" them into 404s; that would leak existence to anyone probing ids.
- **Double-tapping Create on Plans creates exactly one Plan.** Verified by row
  count in Postgres, not by reading the list.

- **The safe-area architecture is sound** (MB-GOD-009). Tokens are canonical,
  zero hard-coded notch values, every pinned element derives from the insets.
  A future notch bug is far more likely to be a NEW surface not consuming them.
  `safe-area.mjs` is the regression check.
- **`env(safe-area-inset-*)` is 0 in headless Chromium** and cannot be
  overridden from script. Do not try to simulate a notch that way; it measures
  the simulation, not the app.
- **`safe-area.mjs` flags `/hangout-mode` as CONTENT-UNDER-HEADER and that is a
  false positive.** Verified by hand: header bottom 76px, first content section
  top 76px. Left visible so the flag keeps its meaning elsewhere.
- **The local DB's missing grants are an environment artifact**, not a product
  defect (MB-GOD-ENV-001): local Postgres 17.6 vs `config.toml` declaring 15.
  Do not add blanket GRANT migrations to force parity, and do not patch the
  production schema on the strength of it.
- **Proximity fixtures go stale after 15 minutes by design.** Re-run
  `seed-proximity.mjs` before proximity assertions, and assert on the ABSENCE of
  measurements rather than a specific band label.
- **Dismiss the tours before any crawl**, or the pass audits the overlay instead
  of the page.

## Session 3 additions to the method

The pattern from session 2 held, and paid again:

- **MB-GOD-010 was found by fixing a defect CLASS instead of instances.**
  MB-GOD-003 was scoped to `components/auth/` — the forms that had been seen. A
  sweep for the SHAPE (onSubmit present, method and action both absent) found a
  second P0 one directory away, on `/admin/login`. Eight forms carried it.
  When a defect is structural, fix the shape and add a guard, not the sightings.
- **The form guard reported its own documentation** on its first run
  (`login-form.tsx:98`, inside the comment explaining MB-GOD-003, which quotes
  the tag it searches for). Comments must be blanked length-preservingly before
  matching — same technique, same reason, as the friendship query guard.
- **Two sequence probes were downgraded from PASS to INCONCLUSIVE.** One hit a
  400 because the API correctly refuses a raw id without a prior search, so it
  exercised nothing and "passed" by not failing. That is the empty-fixture trap
  again in a new costume. A check that could not have failed is not evidence.
- **A weak assertion still earned its keep.** The 404 check accepted "the page
  says 404" and so passed on a 200 — which turned out to BE the defect
  (MB-GOD-012). Strengthening it to assert on status is what surfaced the finding.

## Method notes that earned their keep

Three findings this session were **false positives in the harness**, each
convincing enough to have wasted hours: the nested-interactive-element check,
both safe-area attempts. And two failing checks turned out to be **the test
being wrong, not the app** — the Muddy profile modal (a modal is the better
interaction than a navigation) and the proximity band assertion (the app was
right to stop showing a stale band).

The discipline that caught all five: when a check fails, find out what the app
actually does before concluding it is broken. A failing check is a question, not
a verdict.

## Session 14 — Mission 2 Extremely Advanced

**Question the level answers:** not "is this screen well built?" but **how much
effort does Mad Buddy make a user spend to do ordinary things?**

```
TASK COST          20/20 goals completed   taps: 1 x9  2 x7  3 x4   max = 3
EMPTY STATES       12 audited, 0 defects
FAILURE STATES     offline / 500 / mid-session, 0 internal leaks
HANDOFFS           5 audited, 5 preserve context
ACCESSIBILITY      6/7 (dialog focus-return is the one failure)
TOUCH TARGETS      /linkr and the plan stack now clear 44px; remaining
                   sub-44 controls on Home are inline text links (exception)
```

### What was found

| ID | P | State | What |
| --- | --- | --- | --- |
| MB-GOD-040 | P1 | **FIXED** | Message actions invisible on touch: `opacity-0 group-hover:` + emoji picker dead end |
| MB-GOD-041 | P2 | **OPEN** | Offline in-app navigation → blank page, no way back |
| MB-GOD-042 | P2 | **OPEN** | Muddy profile modal drops focus to `<body>` on close |
| MB-GOD-043 | P2 | **FIXED** | Linkr header + distance controls under 44px |
| MB-GOD-044 | P3 | **FIXED** | Plan stack's keyboard-alternative arrows were 32px |

### Things the next session should not re-derive

- **MB-GOD-040 was the carried open question, and the answer was worse than the
  question.** Both suspicions were true at once: the actions ARE ~17px AND they
  are inside a menu. The defect is the combination — `group-hover` made the
  inline row invisible on touch while `pointer-events` stayed `auto`, and the
  long-press menu's `React` opened a picker in that same invisible row. So the
  ONE action offered to every user on every message was a dead end on phones.
- **`.message-actions` in globals.css is now load-bearing.** Its fade is gated on
  `@media (any-hover: hover)`. Do not convert it back to Tailwind
  `group-hover:` classes — that is the defect. `lib/design/hover-capability-guard.ts`
  is mutation-tested and fails if the shape returns; it finds **zero** other
  occurrences app-wide, so this was isolated, not a class.
- **`any-hover`, not `hover`.** A touchscreen laptop reports `hover: none` when
  the touchscreen is the primary pointer; `any-hover` keeps the trackpad reveal.
- **Task cost is fine and should not be "optimised".** Nothing exceeds 3 taps,
  and all four 3-tap paths are `launcher → destination → the thing` with no
  wasted screen. Collapsing them would mean promoting settings into primary
  navigation — exactly the duplication the Profile restructure removed.
- **Empty states are a strength, not a gap.** All 12 use title + explanation;
  a bare-copy regex matched none. UpFor's are per-tab and the `around` variant
  explains a privacy boundary as a feature. Do not "improve" these.
- **Plans tabs are CLIENT-SIDE filtering** (`setActiveBucket` over plans already
  in memory). No request is made, so a tab switch cannot test a failing read.
- **`public/sw.js:26` deliberately skips navigations** (`request.mode ===
  "navigate"`). That is why offline navigation is blank; an offline fallback is
  a service-worker change and is MB-GOD-041's fix, not a UI tweak.
- **The Muddy profile modal is `open={Boolean(muddy)}`** and the call sites clear
  `muddy` on close, unmounting the Dialog in the same commit — which is why
  Radix cannot restore focus (MB-GOD-042). `components/ui/modal.tsx` does NOT
  override `onCloseAutoFocus`; the primitive is correct, the call sites are not.
- **A feature behind an opt-in has TWO states.** Linkr had only ever been
  audited opted-OUT, where the sole control is "Turn on Linkr" — a true and
  useless reading. Measure both sides of any gate.
- **`MSYS_NO_PATHCONV=1` is mandatory** for every harness invocation passing a
  `/route` argument, exactly as the README says.
- **`hydration-auth.mjs` used to hard-code port 3100** and reported
  ERR_CONNECTION_REFUSED against a production run as if it were a finding. Fixed
  to `MB_BASE`, defaulting to 3200.
- **Seed data must obey the product's invariants.** `direct_key` is
  `[a,b].sort().join(":")`, not a readable tag — a fixture keyed
  "detail-fixture" made the inbox look unable to name a direct conversation. The
  unique index then refused the canonical re-key, proving a real conversation
  already existed and the fixture was a duplicate the product would never create.

### Harness bugs that produced convincing false findings

The task matrix read 13/19 → 16 → 17 → 19/20 → 20/20. **Not one intervening
failure was a product defect.** All five were selector/method bugs: a default
role of `button` that missed every icon-only control; a fragment match ambiguous
between the proximity rail and the list; an `href` ambiguous between the nav and
a Home card; a wrong assumption about which Plans tab holds a hosted Plan; and
MSYS path rewriting. Three probes also measured *nothing* on their first
version — `page.reload()` measured Chromium's error page, a Plans tab switch
filtered in-memory data, and the keyboard check read opacity in the same tick as
`.focus()` (a false failure against a real fix).

**A failing check is a question, not a verdict.** That rule earned its keep
eight times this session.

### Next

**MISSION 2 GOD MODE.** The question is: if Apple/Airbnb/Snapchat/Linear's
strongest designers reviewed this without knowing its history, what would still
keep it from feeling exceptional? Cross-product visual language, emotional
quality, interaction personality, whole-app information hierarchy, visual
rhythm, signature moments, memorability, consistency without sameness.

One concrete input already collected: **Home names a Muddy by first name only**
("KM Kofi Just Around") while `/friends` uses the full name ("Kofi Mensah, open
profile"). Both defensible in place; together it means one person has two
accessible names depending on where you meet them. That is a God Mode
consistency question, not an Extreme defect.

Do not begin a whole-app redesign merely because God Mode is next.

## Session 15 — Mission 2 God Mode, and MISSION 2 CLOSED

```
MB-GOD-041  offline navigation      CLOSED   9/9 runtime checks
MB-GOD-042  dialog focus restore    CLOSED   3 call sites verified by keyboard
MB-GOD-045  Home accessible name    FIXED
MB-GOD-046  nine warm colours       OPEN     (top experience debt)
MB-GOD-047  200% text breakage      FIXED    29/60 → 0/60
MB-GOD-048  launcher overlaps card  OPEN     (P3, measured)
```

### Things the next session should not re-derive

- **`sw.js` is network-only BY DESIGN and that stance is unchanged.** The one
  exception is `/offline.html` + `/offline.js`, precached so a failed NAVIGATION
  gets Mad Buddy's page instead of `chrome-error://chromewebdata/`. Navigations
  are network-FIRST; a 500 or 404 is a real response and is deliberately NOT
  replaced. `lib/security/session-storage.test.ts` pins the exact allowed URL
  list and is mutation-tested — precaching `/dashboard` fails it, and a
  cache-first navigation handler fails it.
- **Six SW guards across five files were REWRITTEN, not weakened.** They banned
  `caches.*` outright, which cannot distinguish a cached conversation from a
  static offline page. They now assert the invariant directly. Net +4 tests.
- **`/offline.html`, `/offline.js` and `/sw.js` are excluded from the proxy
  matcher.** Without that the shell answered 307 and could never be precached.
- **`components/ui/modal.tsx` now owns focus restoration.** Eleven call sites
  pass `open={Boolean(resource)}` and unmount the Dialog in the same commit as
  the close, which is why Radix could not restore. Guarded three ways: only when
  focus fell to `body`, only if the opener `isConnected`, inside rAF. **A
  cross-page opener is deliberately NOT restored** (Plan deep link) — that case
  asserts non-restoration so a fake fix cannot pass.
- **Never size chrome in `rem`** (MB-GOD-047). A rem doubles at 200% text, so
  buttons and icon circles outgrew the screen and primary nav became
  unreachable. Chrome is pixels; icons and text keep rem so the glyph still
  scales. Regression check: `scripts/hardening/extreme-content.mjs`, 0/60.
- **The harness flagged 17 false failures by treating scrollable tab strips as
  clipped.** `plans-page.tsx` already documents that exact false positive. A
  control inside a scrollable ancestor is reachable.
- **A full-page screenshot renders `fixed` elements at document scale.** My
  first reading of Home claimed the bottom nav "floats mid-page" and rows were
  clipped; measuring showed `scrollWidth == viewport`. Capture at viewport size
  when judging layout.
- **Check the BUILD EXIT CODE before believing a runtime result.** One fix
  looked ineffective for two rounds because the build was failing and the server
  was serving a stale bundle.
- **Two JSX comments in expression slots** (`return ( {/* */}`, and inside a
  ternary) are Turbopack build errors, not warnings.
- **Vocabulary has no drift.** Muddy/friend, Circle/Group, UpFor/Hangout each
  resolve to one user-facing term; the others survive only as internal
  identifiers. Do not re-audit.
- **Naming policy, now canonical:** truncate for layout, **never** for assistive
  technology. Greeting surfaces show a first name and announce the full one.

### Next: MISSION 3 — END-TO-END USER JOURNEY / APP FLOW

Not started. Mission 3 examines longitudinal journeys rather than screens: new
user → first value, first Muddy, first Linkr connection, first UpFor → Plan,
first Event → Event Linkr, first Safe Arrival, dormant user returning, user with
zero Muddies, user with active Plans/Events.

Two inputs already collected for it:
- **MB-GOD-046** (nine warm colours) is the top experience debt and needs a
  semantic state token, because Safe Arrival uses orange as a STATE beside red.
- **Signature moments are correct but quiet** — Linkr mutual, UpFor→Plan and
  Safe Arrival completion all work without being memorable. That is a Mission 3
  journey question more than a Mission 2 screen question.

Do NOT start Mission 9.

## Session 16 — Mission 3 Advanced (partial)

```
MB-GOD-049  un-onboarded login skips onboarding   P1  FIXED (mutation-tested guard)
MB-GOD-050  first-Muddy card has no next action   P2  OPEN
MB-GOD-051  message draft lost on reload          P3  OPEN
```

### Things the next session should not re-derive

- **FIRST VALUE is already defined by the product** and the definition is good:
  `first_muddy_added` AND one social act, in `lib/activation/home-maturity.ts`.
  It explicitly rejects Muddy count, profile completion and
  `first_status_created` alone. **Do not change the milestone schema** — the
  model is sound; the gap is the PATH to the second half (MB-GOD-050).
- **Onboarding is entered from ONE place** — the signup action's
  `redirectTo: "/onboarding"`. The login action never checks `is_onboarded`.
  The guard now lives in `app/(app)/layout.tsx` because that wraps every
  authenticated route; a login-only check is bypassed by deep links, shared
  URLs, restored PWA sessions and OAuth callbacks. It compares
  `is_onboarded === false` explicitly — a falsy check would fire on a missing
  profile row and loop accounts created outside signup.
- **`friendships` has NO `status` column.** It is keyed on `ended_at IS NULL`.
  An insert with `status` is rejected by PostgREST and, if the error is not
  read, produces a journey that measures a zero-Muddy account while claiming to
  test a first-Muddy one. Every seed in `journeys-m3.mjs` now asserts success.
- **`admin.createUser` creates NO profile row.** The signup action does. A
  journey seeded without a profile is testing a state the product cannot reach.
- **Turnstile blocks form signup on a local production build.** `next start`
  sets `NODE_ENV=production`, which makes `isTurnstileRequired` true; with no
  secret it fails closed. Correct behaviour, not a defect — create journey
  accounts via the admin API and sign in through the real login form.
- **Dismiss the guided tour in journey runs too.** The first J4b/J6 readings
  audited the tour overlay, exactly as this document already warns for crawls.
- **Home is genuinely adaptive and is a strength.** Zero-Muddy, pending-request
  and first-Muddy each get distinct, well-written copy. The pending-request line
  ("You can add someone else in the meantime — Muddies aren't one at a time")
  solves a journey problem in copy rather than with a feature.
- **Location-denied degrades gracefully** — Home renders without the proximity
  module, no error and no nag, and the rest of the product is fully usable.
- **Linkr is the weakest return loop**: nothing signals that new candidates
  exist. Recorded, NOT fixed — the brief forbids manufacturing notifications
  for retention, and Linkr is where an unsolicited nudge would be least welcome.

### Mission 3 Advanced — what remains before the exit gate

Not yet audited: invite journey (J2), first message (J7), Linkr activation and
mutual (J8-J10), UpFor create/respond/convert (J11-J13), direct Plan (J14),
Plan lifecycle over time (J15), Event and Event Linkr (J16-J17), Safe Arrival
(J18), notification re-entry (J19), dormant and active returning user (J20-J21),
block/safety recovery (J22), privacy change (J23), account management (J24).

`scripts/hardening/journeys-m3.mjs` is the harness to extend — add a journey by
seeding its state, asserting the seed applied, and recording what each surface
offers.

## Session 17 — Mission 3 Advanced CLOSED

```
MB-GOD-049  un-onboarded login skips onboarding  P1  FIXED (previous session)
MB-GOD-050  first-Muddy moment had no action     P2  FIXED — 11/11 end to end
MB-GOD-051  message draft lost on reload         P3  CLASSIFIED, not fixed
MB-GOD-052  Home cannot see unread messages      P2  OPEN
```

### Things the next session should not re-derive

- **The first-value chain is now complete and verified 11/11.** Home's
  first-Muddy card offers "Say hi to <first name>", which calls Home's canonical
  `runRelationshipAction("say_hi", id)` → `openDirectConversationAction` →
  `conversationHref`. Do NOT let the card open a conversation itself;
  `first-muddy.test.ts` fails if it grows its own `/messages` path.
- **The card's two CTAs are ONE conditional**, not two blocks:
  `needsLocation ? "Turn on Glow" : onSayHi ? "Say hi" : null`. Rendering both
  puts the warm thing beside the useful thing. The "offers one primary action"
  test now asserts that chain rather than counting `<Button`.
- **`shouldAcknowledgeFirstMuddy` is TIME-boxed, not act-boxed** — six hours
  (`FIRST_MUDDY_ACKNOWLEDGEMENT_MS`), reasoned in `state.ts`. The celebration
  correctly survives the session and retires next day. I asserted the opposite
  first and was wrong; the probe now tests both sides of the window.
- **MB-GOD-052's structural cause is known**: `unread` appears nowhere in
  `lib/activation/projection.ts` or `home-composition.ts`. The count lives only
  in the app shell's nav badge (`useUnreadMessageCount`, `app-shell.tsx:327`).
  Adding it to Home means deciding its precedence against the Plan and proximity
  modules — that precedence decision is the only work left.
- **Home's priority for an active user is CORRECT** and should not be
  "improved": upcoming Plan → Near → My Plans → Suggestions. A commitment
  outranks proximity.
- **MB-GOD-051 is a storage/privacy decision, not a bug.**
  `lib/security/session-storage.test.ts` holds an allow-list of localStorage
  keys, and every approved key today is a preference or dismissal flag — none
  holds user content. A draft would be the first, and would outlive sign-out on
  a shared device. Decide the clearing story before adding the key.
- **Turnstile blocks form signup on a local production build** (`next start`
  sets `NODE_ENV=production`). Correct fail-closed behaviour. Create journey
  accounts via the admin API, then sign in through the real login form.
- **Linkr is the only WEAK return loop.** Nothing signals new candidates.
  Recorded, not fixed — the brief forbids manufacturing notifications, and the
  honest option is freshness in the surface itself, not a push.

### Next: MISSION 3 EXTREMELY ADVANCED

Four journeys deliberately deferred to it because they need multiple live
accounts: Linkr mutual (J10), UpFor response/momentum (J12), UpFor→Plan and Plan
over time as EXPERIENCE (J13/J15), block/safety recovery UX (J22). The brief
already places "multiple personas" and "pathological combinations" there.

`scripts/hardening/journeys-m3.mjs`, `journeys-m3b.mjs` and
`journey-first-value.mjs` are the harnesses to extend. Every seed asserts its
own success — keep that rule.

## Session 18 — Mission 3 Extreme (partial)

```
MB-GOD-052  Home could not see unread   P2  FIXED — mutation-tested, runtime-verified
MB-GOD-051  message draft on reload     P3  CLASSIFIED (unchanged, per brief)
```

### Things the next session should not re-derive

- **MB-GOD-052's fix is SUPPRESSION, not a module.** `unreadConversationCount`
  enters `HomeCompositionInputs` and only turns OFF `showProfileReminder` and
  `showJourneyCard`. Near, Trending, Moments, `nextBestAction` and the Plan card
  are asserted unchanged. Do not promote unread into a Home module — an imminent
  Plan still outranks it, because a Plan has a time attached and a message does
  not.
- **Use `getUnreadMessageCount`**, never a hand-rolled count. It reads the same
  `conversation_previews` RPC as the inbox and badge and carries a documented
  `status = 'joined'` correction (a production bug where four accounts saw a
  badge no action could clear). It runs only when `muddyCount > 0` and fails
  soft.
- **The Home priority model is now written down** in the audit ledger (8 tiers).
  Two invariants the code enforces: one authority per concept, and maturity vs
  proximity-truth are independent questions.
- **`linkr_record_connect` takes `p_actor` / `p_target` / `p_event_id`** and
  returns `{ matched, connection_id, created }`. NOT `p_actor_id`, NOT
  `is_mutual`. A wrong param reads as "function not found"; a wrong field makes
  both assertions vacuous.
- **Linkr's trust property is verified from the recipient's side**: one-sided
  interest is invisible on `/linkr` AND `/notifications`, and a Linkr connection
  creates no friendship row.
- **Block leaks nothing.** The blocked person sees no block language; the
  blocker simply stops appearing. When testing this, strip the `/friends`
  navigation chrome first — the "Blocked" filter tab makes a bare `/blocked/i`
  match fire on every account.
- **`profiles_username_format` rejects hyphens.** A tag-based fixture username
  like `mx-unread` fails the insert.
- **Beware a probe matching its own fixture.** The first priority matrix
  reported "unread shown: YES" because the account was named "Mx-unread Tester"
  and the greeting matched `/unread/i`. Strip the greeting before content tests.

### Mission 3 Extreme — what remains

UpFor momentum (C) and UpFor→Plan (D) as multi-user EXPERIENCE; multi-device
continuity (H); session expiry mid-flow (I); offline/reconnect journey recovery
(J); abandoned creation (K); time transitions (L); burst re-entry (M); extended
permissions — notifications, camera, microphone, file access.

`scripts/hardening/journeys-multi.mjs` and `home-priority-matrix.mjs` are the
harnesses to extend. Every fixture asserts its own success — keep that, and
assert the SHAPE of any RPC result before asserting behaviour.

## Session 19 — Mission 3 Extreme CLOSED

```
UpFor momentum            PASS 7/7   (3 live people)
UpFor -> Plan             PASS 6/6   (nobody silently enrolled)
Multi-device / expiry / offline  PASS 6/6
Extended permissions      PASS 10/10 surfaces, 0 asks on navigation
Home priority matrix      PASS 4/4
Return loops              6 STRONG, 1 WEAK (Linkr)
```

### Things the next session should not re-derive

- **UpFor conversion does not enrol anyone silently.** A pending responder is
  ABSENT from the converted Plan; only an accepted one carries over as `going`.
  `lib/plans/service.ts:477-478` passes `p_invitee_ids: []` and
  `p_initial_going_ids: []` — the RPC projects participants from the UpFor's own
  accepted requests, so there is no second definition of who joins.
  `p_request_key: hangoutId` makes one UpFor become exactly one Plan.
- **Failure messaging is already right.** An expired session and an offline send
  both produce "The message could not be sent. Try again.", write nothing, and
  duplicate nothing on reconnect. The app stays on the conversation rather than
  redirecting to login — there is nothing to return to, because the user never
  left.
- **Permissions are contextual everywhere.** Nothing is requested on ordinary
  navigation (verified by wrapping getUserMedia, Notification.requestPermission
  and getCurrentPosition), and all ten surfaces stay usable with every
  permission denied.
- **Schema facts that have each cost a probe:** `hangout_sessions` keys on
  `owner_id` (not host_id); `hangout_ends_after_start` forbids dragging
  `ends_at` into the past, so simulating expiry moves the whole window;
  `linkr_record_connect` takes `p_actor`/`p_target`/`p_event_id` and returns
  `{ matched, connection_id, created }`.
- **Abandoned creation, classified by measured effort:** Plan = 5 inputs
  including a date/time pair (SHOULD PERSIST), UpFor = 2 and deliberately cheap
  (ACCEPTABLE TO RESET), Event = 0 at its first step. None implemented.
- **Linkr behavioural block guard stays classified.** Attempted this session.
  `connectWithCandidateAction` is a "use server" action needing Next's action-id
  encoding, plus an activated Linkr profile on both sides. The brief forbids
  substituting the reciprocity RPC as proof.
- **Linkr is still the one WEAK return loop**, and that is deliberate. The
  mutual moment is handled well; nothing gives a truthful reason to come back
  and find one. Carried to God Mode rather than patched with streaks or urgency.

### Next: MISSION 3 GOD MODE

Fresh session. The question: does Mad Buddy systematically move people from
setup → relationship → social opportunity → real-world connection → meaningful
return? Activation quality, network effects, empty-network survival, density,
cross-feature conversion, emotional progression, trust accumulation, healthy
retention, long-term failure states.

The Linkr return loop is the single largest open journey question and belongs
there.

## Session 20 — MISSION 3 CLOSED (all three levels)

```
God Mode findings: P0=0 P1=0 P2=0 P3=0
Empty network      9/9 surfaces, zero graveyards
Home over time     4 states, every transition correct
Linkr              WEAK — density-limited, deferred with a truthful direction
```

God Mode produced an **architecture**, not a defect list. Nothing was broken;
what the product lacks is network density, which is not a bug.

### Things the next session should not re-derive

- **The activation lifecycle is now written down** (audit ledger): SETUP →
  ACTIVATION (`first_muddy_added`) → FIRST VALUE (+ one social act) → SECOND
  VALUE (two-sided conversation or Plan) → RETENTION VALUE. Do not redefine it;
  it was validated against behaviour, not invented.
- **Welcome Access should start at `first_muddy_added`** — the first
  non-reversible event requiring another person to agree, already carrying a
  `reached_at`. Recommendation only; no schema created. Monetization Reset
  consumes this.
- **One Muddy is enough** for Glow, Message, UpFor, Plan and Safe Arrival. Only
  Linkr and Events need strangers. Invite is the ONLY bootstrap for the private
  graph.
- **Linkr's root cause is data-side, not UI.** `candidate-service.ts` already
  computes `candidateJoinedToday` and `candidateActiveNow`, and
  `linkr_profiles` carries `only_new_today` / `only_active_now`. Freshness
  exists but is exposed only as filters the user must set and one card chip —
  never as "has anything changed since I was last here". A fix needs a
  last-visited timestamp (schema decision) and will still say nothing truthful
  at low density. Dark patterns are prohibited.
- **Notification dependency is classified** for Native Readiness: only Safe
  Arrival is functionally broken without push. Linkr mutual is the only fact in
  the product with no in-app surface that changes.
- **`loadMaturityEvidence` is the first Mission 9 target** — it reads every
  direct conversation's messages on every Home with ≥1 Muddy.
- **No trust reversal exists.** The privacy promise is restated at signup, first
  Muddy, Event check-in, Safe Arrival and Linkr, and never weakens later.
- **Feature distinctions hold** — no merge is warranted between Linkr/Muddies,
  UpFor/Plans, Plans/Events, Event Linkr/Linkr, or Circles/Plan Chat.

### Next: MISSION 4 — INFORMATION ARCHITECTURE / PAGE RESPONSIBILITY

Not started. Some IA work already landed (the Profile/Settings responsibility
correction in Mission 2, and MB-GOD-007's `/hangout-mode` rename remains
owner-blocked), but Mission 4 still needs its own formal Advanced, Extreme and
God Mode passes. Do not skip it because those findings exist.

## Session 21 — Mission 4 Advanced CLOSED

```
Surfaces mapped        22/22, every one holds exactly ONE primary job
Duplicate indexes      0
Duplicate authorities  1  (MB-GOD-053, P2, open)
Legacy dead routes     0
Deep-link ownership    6/6
Nav responsibility     5/5 durable mental models
Profile lock           PRESERVED
```

### Things the next session should not re-derive

- **MB-GOD-053 (P2, open):** two implementations of "create a direct
  conversation". `lib/messaging/service.ts` owns
  `getOrCreateDirectConversation` (eligibility + create-race handling);
  `lib/linkr/connection-service.ts:252` reimplements it inline. NOT a security
  defect — Linkr checks blocks before writing anything and reuses an existing
  conversation. It is one job with two implementations that will drift.
  `getOrCreateDirectConversation` already supports the `context` parameter
  Linkr needs.
- **`<main>` CONTAINS the app header.** Any link-topology probe must exclude
  `header`/`nav` descendants, or the shell's own links count as page content on
  every surface. This produced four false duplicate-index findings on the first
  run.
- **Profile's 6 links are NOT a lock regression**: the `/settings/glow-visibility`
  tour anchor, two identity chips, and three activity stats (counts of what you
  have done). The code states the rule — *"Profile keeps ONE entry point rather
  than a second copy of the surface."*
- **Route classifications:** `/discover` is a documented COMPATIBILITY ALIAS to
  `/linkr` (preserves `eventId`); `/moments` is flag-gated; `/safety` is a role
  redirect (staff → `/admin/reports`); `/hangout-mode` stays MIGRATION-BOUND
  under MB-GOD-007. **No LEGACY DEAD routes exist** among 92 page routes.
- **`/discover → /linkr` is the proven pattern for MB-GOD-007's eventual
  rename**: keep the old route as a documented alias rather than deleting it.
- **Nav is 5 durable mental models**, and Plans/Events are deliberately
  secondary because both are outcomes of the primary five. Home already
  surfaces an upcoming Plan at tier 4. Do not promote them without new evidence.
- **`friendships` is the healthy authority shape**: read in 36 files, mutated in
  3. Wide readership, narrow write authority.

### Next: MISSION 4 EXTREME

Cross-feature ownership under pathological states, aliases and redirects, data
migration authority, admin/user boundary, state ownership during conversions,
stale routes, information scent, deep-link consistency.

`scripts/hardening/ia-responsibility.mjs` is the harness to extend.
