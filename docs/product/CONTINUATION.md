# God Mode hardening — continuation report

## Optional feature launch release — 4 October 2026

- PR #128 merged as `e9c836d079ae443d728dd57be37cb4a7b7047264`.
  Exact candidate CI passed; 578 root suites / 9,418 tests passed; native tests,
  type checks and web/native production builds passed.
- Production migration applied to `cabkhxxnrybzhkbtoiiz`: 175 history entries,
  remote head `20261004205231`. All five optional launch flags are off:
  UpFor, Linkr, Events, Conference and new Safe Arrival journeys.
  Verified 42 restrictive policies, four insert guards, zero release policies
  on core tables. Existing records and safety completion remain supported.
- Production deployment `dpl_DFeQ9QPFiTLZFQqDf1FxKoPWwN96` is READY.
  `mad-buddy.com/api/version` serves the exact merged commit; readiness is 200
  with `ok: true`. Signed-in live browser checks passed for all five blurred
  lock screens, Quick Actions/Settings padlocks, Home/Glow, Muddies, Messages
  and Plans. The Home SmartCard recommended Plans; historical SmartCard state
  is preserved. The preview-only review fixture is 404 in production.
- Admin → Features can unlock each feature independently without redeploying.
  No production flag toggle or user-content mutation was used for smoke checks.
- Limits: full local DB suites require a local stack/operator configuration;
  runtime log retrieval was access-blocked; no new native store binary released.
  See `docs/optional-feature-launch-controls.md` for the complete release report.

## Current audit release — 3 October 2026

- Durable push follow-up is prepared on `fix/durable-push-delivery`: transactional
  dispatch persistence, independent device retries, fenced acknowledgements,
  cron recovery, send-time preference/block/deletion checks and deletion cleanup.
  Both new migrations (`20261003213820`, `20261003214905`) are staging-only.
  Apply both before deploying code. Delivery remains at least once; no real
  device push or production readiness diagnosis has been verified.
  Validation: 576 files / 9,400 passing tests / one skipped; types and production
  build passed. See the operations report for limits and staging rollback proof.

- PR #125 merged as `2cb0ecd6bd3f77d1b10c1940688ca9ca18fa8028`.
  Exact candidate `2f40af42ceb4e3e34ec9e5009af9dd5b1c1ec4e3` passed all
  three GitHub CI jobs (quality, production build, mobile).
- Both reviewed database migrations are applied to Production
  `cabkhxxnrybzhkbtoiiz`, with canonical versions `20261003205830` and
  `20261003210234`. Verified history: 172 entries, head `20261003210234`.
- Production grants and all four new guards were verified. Four stalled
  deletion requests remain untouched; never auto-resume them.
- Production domain serves commit `2cb0ecd6bd3f77d1b10c1940688ca9ca18fa8028`,
  deployment `dpl_3L6ioT5Ly78Bh28svqvA3E53Knwv`. Homepage, login, version and
  shallow health return 200; deeper readiness still returns 503. All three
  post-merge CI jobs also passed. Readiness remains an open release limitation.
- Focused deletion cascade, membership, block precedence, immutable-event and
  budget checks passed on synthetic staging fixtures, all rolled back.
  Full browser/Auth API/Storage deletion and real-device push are unverified.
- Remaining work: exact readiness failure/configuration, durable push retries,
  independent monitoring, backup/restore proof, provider patch/hosting review,
  real-device and load evidence. See
  `docs/operations/AUDIT-HARDENING-2026-10-03.md` for boundaries and scope.
- Code rollback baseline: `941631d4d04e4503887ebbea29ea8b5dcf3de028`.
  Additive database guards remain in place; do not blindly reverse migrations.

The historical report below predates this release and is retained as history.

**Written at the end of session 24 — PRE-MONETIZATION BASELINE.** The next session continues from here.

```
WORKTREE     C:\mb-god
BRANCH       hardening/god-mode-product-pass
HEAD         (see foot of file)
ORIGIN/MAIN  3a42cc06e1506682595de544ca335abc3c110749  (unchanged, nothing pushed)
STATUS       clean
COMMITS      93 local recovery checkpoints, none pushed, nothing deployed
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
| 4 — Information architecture | Extremely Advanced | **COMPLETE.** MB-GOD-053 RESOLVED; 054 and 055 open. 5 conversions, 55/55 admin actions authorized, 13/13 write paths, no shadow state. P0=0 P1=0 P2=2 P3=1. |
| 4 — Information architecture | God Mode | **COMPLETE.** One architecture across UI/routes/backend/data, with two naming exceptions. MB-GOD-054 and 055 RESOLVED; 056 open P3. |
| **4 — Information architecture** | **ALL THREE LEVELS** | **COMPLETE — closeout in the audit ledger** |
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
- New users get **14 days WELCOME ACCESS, no card required, no auto-renew**,
  starting at `first_muddy_added` — not at signup, so the clock begins when the
  product has actually delivered something.
  (Corrected from "roughly 30 days": 14 is the locked figure.)
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

**Domain 6 — Profile media (NOT STARTED)** is the larger pie…14768 tokens truncated…n
- Live GHS 5 payment test NOT RUN — see the section above.
- No clean production QA identities exist, so every authenticated production E2E
  remains NOT EXECUTED. Design is in the schema-wide audit report; creating the
  accounts needs separate authorisation. Never reuse a real customer account.
- Dead 4-argument `transition_safe_arrival` overload — unreachable by any caller
  (PostgreSQL cannot disambiguate it), harmless, worth dropping in a future
  cleanup.
- `v4-actions.local.test.ts` flakes once on the first local run after
  `db reset` + seed; passes in isolation and on re-runs.
- The `storage` schema still grants browser EXECUTE on postgres-owned functions.
  Supabase platform territory, deliberately untouched.

---

## Smart Card V2 — Home's one adaptive card

```
CURRENT MAIN            b6fc25431b48c57dd38ef042743b70519534d454 (PR #28 merged in)
PRODUCTION MIGRATIONS   137 (unchanged — this programme added none)
SMART CARD PR           #27 (DRAFT)
SMART CARD FINAL HEAD   see PR #27 head; last code commit 402313b, merged with main
STATUS                  COMPLETE / READY FOR CHATGPT FINAL REVIEW
PRODUCTION              UNTOUCHED
```

### The architecture, in one place

Home runs three surfaces with different jobs, and they are never collapsed:

```
CARD A       FirstMuddyCard / ActivationCard   activation + relationship progression
CARD B       SmartCardHeroV2                   obligations, live context, opportunity
NEARBY HERO  NearbyHero                        the proximity payoff
```

Eligibility is decided by TIER, not by a list of ids, so a new catalog state
inherits the right behaviour without anybody editing Home. Tiers 0–2 always
qualify; 3–6 wait until early activation stops owning the screen. Card B renders
quiet whenever Card A is on screen — except tier 0, which keeps full authority
because a live Safe Arrival outranks every teaching moment.

### What closed

- **Family 1 HOME/V2** and **Family 2 UPFOR** — complete before this tranche.
- **Family 3 LINKR/RELATIONSHIP** — `linkr_mutual_event`, `event_linkr_ready`,
  `muddy_birthday` wired on top of the existing `muddy_request` + `linkr_mutual`.
- **Family 4 DECISIONS** — `plan_decision`, `plan_chat_decision`.
- **Family 5 GROWTH/RECOVERY** — `profile_blocking`.
- Action, media and query/fanout audits; runtime proof extended.

```
TOTAL APPROVED CATALOG STATES   57
WIRED CARD B                    31 catalog entries / 30 providers
                                (safe_arrival_overdue + safe_arrival_action
                                 share one live-journey provider)
CARD A OWNED                     6
NEARBY HERO OWNED                2
OTHER EXISTING HOME SURFACE      7
DEFERRED — NO CANONICAL AUTHORITY 10
DEFERRED — PRODUCT PAUSED        1
```

Every one of the 57 is classified individually in
`lib/smart-card/catalog-classification.ts`, and the classification is VERIFIED
AGAINST THE ENGINE by `catalog-classification.test.ts` rather than maintained by
hand — a matrix that rots is worse than none.

The split that matters is between the two kinds of absence, which an earlier
draft of this document conflated into a single "23 deliberately unwired":

- **7 states another Home surface already owns** — the "Coming Up" agenda rail
  (`plan_upcoming`), the Trending Events rail (`event_saved`,
  `event_friend_context`), Home's Safe Arrival section
  (`safe_arrival_watcher_request`), the profile completion reminder
  (`profile_completion`), Tours (`walkthrough`), and Groups
  (`group_invitation`). These are settled answers. A Smart Card for any of them
  would be one screen saying the same thing twice.
- **10 real authority gaps** — the table below.
- Plus 6 Card A owns, 2 NearbyHero owns, and 1 paused product decision.

The catalog is a product vocabulary, not a quota. Several states are correctly
absent, and the reasons are recorded as tests in
`lib/smart-card/recovery-family.test.ts` so a future provider cannot be added
without confronting the gap.

### The 10 real authority gaps

| State | Missing authority |
|---|---|
| `plan_changed` | No plan-edit action exists at all (create/cancel/RSVP/poll only), so there is no meaningful change to review. `plan_participants.viewed_at` is dead schema nothing writes, so there is no unseen-state authority either. **Both** halves are missing. |
| `invited_friend_joined` | `invite_links.creator_id` exists, but accepting an invite creates a pending Muddy request — already owned by `muddy_request` — and records `invite_signup` only through `recordProductEvent`, which is best-effort analytics, not a product reader. |
| `linkr_opportunity` | `sharedInterests` is computed inside candidate ranking and never exposed on `LinkrCandidate`, so there is no grounded reason to show. Reproducing discovery on Home would also run the ~12-query candidate reader every render and pre-expose a person outside Linkr. |
| `event_invitation` | No `event_invitations` table; RSVP is only `interested`/`going`/`not_going`. `event_circle_invitations` are Room invites, a different state. |
| `notification_action_bundle` | The only classification that exists is "has a destination", which counts ordinary updates like `friend_request_accepted`. A second actionability definition would give the product two answers to one question. |
| `message_context` | Needs the ~6-query inbox reader per render; the only cheap fact is a bare unread count — the inbox duplication the ranking exists to prevent. |
| `returning_user` | No user-level last-visit record. `push_subscriptions.last_seen_at` is device-token freshness; `conversation_presence` is per-conversation. |
| `offline_status`, `failed_action` | Pending/failed sends live in the Messages page's own client state, invisible to a server-rendered Home. No durable server failure queue exists. |
| `location_permission`, `notification_permission` | Card A owns permissions. |
| `feature_announcement`, `access_status` | No canonical announcement source; monetization gating is paused. |

**Moments = NONE.** Absent from the catalog entirely, asserted whole-word (so
`upfor_momentum` does not false-positive) and from the wired set.

### Privacy contract

Proximity stays qualitative; Event Linkr stays consent-aware; Linkr stays
mutual-only; messaging stays membership-aware; Plans stay participant-aware.

- **No OTHER user's raw date of birth is read for `muddy_birthday`.** The
  birthday *delivery ledger* is the DATE authority — whose birthday is today,
  and whether this viewer was allowed to be told — and `MuddyBirthdayForCard`
  carries no date field to leak.

  **The ledger is not standing permission.** It records what was true when the
  hourly job ran; a block, an ended friendship or a privacy change since then
  leaves the row intact while `sendBirthdayWish` would refuse with "This
  birthday wish is no longer available". Home therefore re-reads the four
  revocable facts — birthday field privacy, announcement preference, live
  friendship, block in either direction — for the delivered owners at render
  time, batched, still without touching a date of birth. The historical row is
  never deleted: it records what happened, and rewriting it to achieve a UI
  outcome would falsify the record. The viewer's OWN `profile_birth_details.date_of_birth` remains the
  canonical authority for their own `birthday` card, read by the dashboard as it
  always was. An earlier draft of this document said "no date of birth is read to
  build Home", which was false: it described the `muddy_birthday` guarantee as
  though it covered the whole screen.
- **Event context on a mutual is stored, never inferred.**
  `linkr_connections.event_id` is the pair's own fact, written when they matched
  through Event Mode — not an overlap computed from two attendance histories.
- **Consent is offered, never granted from Home.** `event_linkr_ready` appears
  only on `no_consent` against a live check-in and links to the Event, where the
  opt-in control lives. Proven at runtime in both directions: granting consent
  removes the offer; removing the check-in removes it too.
- **No message text reaches Home.** `plan_chat_decision` reads `chat_polls` in
  conversations the viewer has *joined* — membership first, so a poll in a chat
  they are not in is never fetched rather than filtered afterwards.

### Query/fanout

Home does more data work than before, and the honest way to say so is to name
the two phases rather than to report "18 → 18 unchanged":

**Helper branches are not database round trips**, and reporting one as the
other hides real cost. Both numbers, separately:

```
MAIN HOME PARALLEL BATCH          18 readers   (unchanged)
POST-AGENDA PROJECTION             1 projection, 6 helper branches in parallel
```

| Helper branch | Actual DB/RPC calls |
|---|---|
| `loadEventLinkrOffer` | 2 direct (`check_ins` limit 3, then one `events` by id) **+** `resolveEventLinkrEligibility` per checked-in event (bounded at 3, returns on first match; itself reads `events`, `check_ins`, `event_linkr_opt_ins`). Zero beyond the first when the viewer is not checked in anywhere — the ordinary case. |
| `loadMuddyBirthdays` | 5 direct (`birthday_notification_deliveries`, `profiles`, `profile_field_privacy`, `user_preferences`, `friendships`) **+** `batchBlockedIds` (1). All batched over the delivered owner set (limit 10). |
| `loadPlanDecisions` | 2 (`plan_polls`, `plan_poll_votes`), bounded by the agenda's plan ids. |
| `loadPlanChatDecisions` | 4 (`conversation_members`, `conversations`, `chat_polls`, `chat_poll_votes`), membership first. |
| `loadBlockedFeature` | 1 direct (`linkr_profiles`) **+** `resolveAge` (1) and `hasProfilePicture` (1) — and it short-circuits to a single read when Linkr is off, which is most viewers. |
| `loadAccessForCard` | `resolveAccessForUser`, which fans out to 4 parallel indexed reads (`access_grants`, `access_global_windows`, `admin_users`, paid subscription). |

```
PROVIDER QUERIES                   0  (providers remain pure)
LINKR COLLECTION ACTIVITY          1  bounded conversation_previews RPC
DUPLICATE DOMAIN READERS           0
N+1                                0  — and one pre-existing N+1 FIXED
```

**Why it runs serially after the batch:** the decision readers are bounded by
the agenda's plan ids, which are already permission-filtered. Passing those in
is what keeps the projection cheap and what makes it impossible for it to reach
a Plan the viewer cannot see — so it has to wait for the agenda rather than
join the parallel batch.

**Bounded loops:** one, in `loadEventLinkrOffer`. It iterates the viewer's own
live check-ins, capped at three by its query and returning on the first match,
so its cost does not grow with any table.

**The Linkr activity read, and two wrong shapes on the way to it.** It began as
one `messages` COUNT per connection — 40 round trips for a 40-person
collection. That was replaced with a single
`messages.select("conversation_id").in(...)`, which fixed the round trips and
introduced a worse problem: it transferred every undeleted message row across
every Linkr conversation to answer a yes/no question. One query, unbounded
payload, on every Home render. It now uses the existing `conversation_previews`
RPC, which returns exactly one row per conversation whatever the size of its
history, and whose `deleted_at is null` filter preserves the rule that a
conversation whose only message was deleted still reads as "Say hi".

### Entitlement (Mad Buddy Access)

Home resolves entitlement through the canonical `lib/access/resolver`, the same
authority every gated Linkr and UpFor mutation uses, so Home cannot offer an
expansion the server would then refuse. It applies `lib/access/guard.ts`'s rule
verbatim: **expiry stops the NEXT EXPANSION, it never destroys an EXISTING
COMMITMENT.**

Only two states gate:

| State | Why it gates |
|---|---|
| `event_linkr_ready` | Being discovered by new people at an Event is Linkr discovery. The server refuses the opt-in without Access, so offering it would send somebody to a door that will not open. |
| `profile_blocking` | It promises that finishing the profile makes you discoverable. Without Access that promise does not come true, so the card would ask for work that changes nothing. |

Everything else is untouched, and a test asserts that **byte-for-byte**: for an
entitled and an unentitled viewer, every other card is identical JSON. Existing
Linkr mutuals (with and without Event context), owned UpFors, Muddy-side UpFors
both pending and accepted, Plans, Plan Chat decisions, Muddy requests,
birthdays, Journey and Safe Arrival all behave exactly as before.

The guaranteed fallback is the one card that cannot return null — it is the last
provider, so Home would blank — and it therefore changes its WORDING rather than
disappearing, pointing at what is still free. Copy never counts down, never
sells, and never implies Mad Buddy itself has ended; that is asserted over every
producible card, not just the fallback.

**There are THREE entitlement states, not two**, and the third is the one that
was originally wrong:

```
KNOWN + access      expansion offers allowed
KNOWN + no access   expansion offers suppressed
UNKNOWN             expansion offers suppressed, everything else intact
```

An earlier revision collapsed UNKNOWN into "allowed", reasoning that Home should
fail open. That was the wrong boundary. Failing open matters for CONTINUITY --
but no continuity provider reads the flag at all, so those cards were already
safe. Expansion is different: advertising Event Linkr discovery while the
resolver is unavailable promises a door the server may refuse, and telling
somebody that finishing their profile will make them discoverable may simply be
untrue. Suppressing an offer costs a card; a false promise costs trust.

UNKNOWN and KNOWN-no-access are **byte-identical on screen**, asserted by test,
so the state of the entitlement system cannot leak into somebody's Home.

`AccessForCard` carries `canExpand` and nothing else -- sources, expiry dates
and days-remaining all invite a card that counts down or nags. `hadWelcomeAccess`
was removed: it cost a historical-grant read on every Home render and no card
ever consumed it.

### Button copy

Every wired Card B action uses the **canonical owner of the next product
step**. Navigation stays a link when navigation is enough; a canonical server
action is used when opening the next surface requires an authorized mutation.

> An earlier revision of this document said "every Smart Card action is a
> link". That was too rigid, and a real user report broke it: an accepted UpFor
> needs to open the conversation with the person who said yes, and that
> conversation may not exist yet — only the server may decide whether the pair
> is allowed one. `SmartCardActionIntent` is the one narrow variant, carrying a
> single id; `destination` stays set as the honest fallback, so no card is ever
> actionless.

None of it mutates from Home while rendering. The Plan invitation's "RSVP" became
**"Respond"** for that reason, and a test rejects any label phrased as a
completed mutation.

**A card that names one thing opens that thing.** Every destination that could
name a specific object now does:

| State | Destination |
|---|---|
| `linkr_mutual`, `linkr_mutual_event` | `/linkr?connection=<id>` — deliberately **late-bound**: it re-resolves at open time, so a block or ending since Home rendered fails closed, and a conversation started since then opens instead of a stale "Say hi". |
| `plan_decision` | `/plans?plan=<id>` |
| `plan_chat_decision` | `conversationHref(id)` → `/messages?conversation=<id>` |
| `muddy_request` | `/friends?tab=requests` — `/friends` defaults to the **all** tab, so the card named a screen and opened a different one. |
| 5 single-session UpFor states | `/hangout-mode?hangout=<id>`, which the page centres. `upfor_requests` stays generic because it summarises across every UpFor the viewer owns. |
| `muddy_birthday` | `/notifications` — and the label is **"Open birthday wishes"**, because that opens the notifications *list*; the wish composer opens from the birthday row there. |
| `upfor_accepted` | **Message &lt;owner&gt;** via `openDirectConversationAction`, then `conversationHref`. Secondary `View UpFor` → `/hangout-mode?hangout=<id>`. See below. |

### Accepted UpFor is a transition, not a destination

Reported from real phone use: after somebody accepted the viewer's request to
join their UpFor, Home said "You are in" and offered **Open UpFor** — sending
them back into the surface whose question had just been answered. The discovery
loop had already succeeded; the next job was to coordinate.

- **accepted, unconverted** → coordinate with the owner (`Message <name>`), with
  the UpFor detail demoted to secondary.
- **converted to Plan** → Plan / Plan Chat authority takes over. No code was
  needed for that: `loadHomeUpForContext` reads joined sessions as
  `status = 'active'` and the canonical lifecycle sets `converted_to_plan`, so
  the session simply leaves the joined set and the accepted card yields. It is
  deliberately *not* kept alive so it can say "Open Plan Chat".

**The offer is withheld where messaging could not be allowed.** Direct messaging
requires approved-Muddy or an active Linkr connection, and an accepted UpFor is
neither on its own. Every audience except `selected_groups` already refuses a
non-Muddy, so being in the session proves mutuality for those; a public Group
UpFor is the one audience that admits a stranger, and there the card keeps the
truthful UpFor route as its primary. The hint can only ever *remove* an offer —
the server still decides at click time.

Cost: **zero** extra Home reads. `ownerId` and the audience hint ride the
`hangout_sessions` select that already ran to resolve the owner's name.

### Runtime proof

Two harnesses against the **real rendered Home** (`next start`, real login flow,
local fixtures only — never `next dev`, never production):

```
scripts/hardening/smart-card-visual-proof.mjs     core V2       PASS
scripts/hardening/smart-card-families-proof.mjs   families 3-5  116/116 PASS
```

The families harness follows RENDERED hrefs rather than asserting provider
strings: `Say hi` resolves to `/linkr?connection=<uuid>` and opens Linkr for
that connection, `Vote now` opens that exact Plan, and `Review requests` lands
on Muddies with the Requests tab selected. It drives all three entitlement
states against real `access_grants` rows — HAS ACCESS, NO ACCESS, and EXPIRED
ACCESS WITH AN EXISTING COMMITMENT, where the mutual matched before expiry still
shows and still offers "Say hi" — and proves birthday revocation in both
directions: a block after delivery removes the card, and lifting it brings the
card back.

360/393/430 · light + dark · 200% text · reduced motion · no overflow ·
44px targets · no nested interactive elements · Nearby not duplicated ·
no coordinates, distances, dates of birth or ages anywhere on the page.

### Two harness traps worth remembering

- **A fixture that fails must stop the run.** The first families run used two
  invalid enum values (`plan_type: "hangout"`, `events.status: "published"`),
  created nothing, and reported eleven convincing "product defects" that were
  just a Home with no fixture on it. `must()` now hard-stops on any fixture error.
- **`weekend_plans` is tier 4 and eligible Friday evening to Sunday**, so it
  legitimately outranks tier-5 `profile_blocking` — and that scenario passed or
  failed depending on the day the proof ran. It now acknowledges the weekend card
  first, measuring the card instead of the calendar. The same trap has a second
  form: asserting a SPECIFIC low-tier card renders is asserting the fixture
  account's state, not the product, because any higher-tier state legitimately
  wins. Where the competing states cannot be held still, assert the invariant
  ("a card renders, and it is not an expansion") and pin the exact copy in a
  unit test instead.
- **Two harnesses sharing one fixture user must each clear what the other can
  create.** Fixture Plans were cleaned only by last-tracked id, so leaked ones
  tripped `PLAN_ACTIVE_LIMIT_REACHED` in an unrelated local suite; and this
  harness never cleared the UpFor state the CORE harness creates, so a leftover
  tier-1 UpFor outranked every state being measured. Both produced convincing
  false defects.

### Quality at the final head

```
test:release   8386 passed (8233 + 153 local)
               1 known pre-existing failure: v4-media-shares.local Event Room
               inbox identity, which fails identically on clean origin/main and
               is untouched by this branch (see the Event Room inbox defect)
tsc            0 errors
eslint         0 errors (112 pre-existing warnings in hardening scripts)
build          PASS
migrations     137, zero diff against main under supabase/
main           merged clean (b6fc254, PR #28 ops handoff) -- 0 conflicts
```


---

## Home intelligence correction — Card A ownership and the UpFor lifecycle

Three defects found on a real phone, all the same underlying mistake in
different places: **a card confusing a STATE with a JOB**, or with somebody
else's job.

### Card A stopped guiding

`upcomingPlanCount > 0` was the FIRST check in `resolveActivationState`, so one
future Plan returned `upcoming_plan` ahead of every activation question below
it. Card A became a permanent "You've got something on / Open your plan"
billboard, and somebody with no Muddies, no location, or Glow still off was
never told any of it.

A Plan is a commitment, not an activation step, and it was already owned three
times over — Card B's `plan_rsvp` / `plan_decision` / `plan_starting` /
`plan_chat_decision`, plus Home's "Coming Up" rail. Card A's version named
nothing and outranked everything.

**Corrected ownership:**

| Surface | Owns |
|---|---|
| CARD A | activation and relationship progression — and nothing else |
| CARD B | obligations, live context, decisions, coordination, opportunity |
| NEARBY HERO | the proximity payoff |

When activation has nothing left to say, Card A resolves to `activated` and
renders **nothing**. Whitespace beats a prompt that has stopped being true.

`upcoming_plan` is kept in the type and copy map: it is still reachable through
the explicit relationship-focus path.

### The UpFor lifecycle, end to end

Previously the catalog described `upfor_active_muddy` as *"a relevant Muddy is
UpFor something now"*, but the wiring only ever looked at sessions the viewer
had **already requested to join**. The discovery moment never reached Home at
all. That description was wrong and is corrected here.

```
a Muddy puts something out   -> upfor_opportunity    "See UpFor"
the viewer asks to join      -> upfor_active_muddy   "Details" / Waiting on them
the owner says yes           -> upfor_accepted       "Message <owner>"
the viewer actually writes   -> the job is DONE, and something else wins
```

**Discovery** (`upfor_opportunity`, new) reads a bounded, Muddies-only
projection: friendships, then their ACTIVE, already-started, not-yet-ended
sessions with `audience_type = all_muddies`. That last narrowing is what makes
it safe without duplicating anything — `canViewHangout` refuses a non-Muddy for
every audience except `selected_groups` and then narrows further per audience,
so Home asks only for the one audience where being a Muddy *is* the whole
answer. Stranger/"nearby" discovery is the paid expansion side of UpFor and
stays on the UpFor screen, which resolves it properly.

**Completion** (`coordinatedSinceAccepted`) is the fact that was missing.
`myStatus === "accepted"` stays true for the life of the session, so selecting
on it alone made Home repeat "Message Kofi" to somebody who had just messaged
Kofi. A message now qualifies only if it is in the canonical direct
conversation, sent **by the viewer**, not `system`, not deleted, and created
**after** the acceptance timestamp. Opening the conversation does not count;
yesterday's chat does not count.

Two batched reads answer it for the whole set — conversations by `direct_key`,
then the viewer's own qualifying messages, newest first, capped. A viewer with
no accepted UpFor pays nothing. `responded_at` is nullable on legacy rows and
falls back to the request's `created_at`, which is conservative in the safe
direction. **No migration.**

**Retirement is per object.** Evidence is per session, so completing one
acceptance never silences another, and nothing is acknowledged permanently.

### Home refreshes when the person acts

Requesting, responding to, and ending an UpFor now invalidate `/dashboard` on
success, scoped to Home only. Sending a message already did. Without it a
viewer sat looking at a card describing a state they had already left.

### Two fixed card backgrounds

Card A always wears `card-a-background.png`; Card B always wears
`card-b-background.png`. Neither is ever chosen by state.

This replaces two opposite mistakes: Card A hardcoded
`/home/open-your-plan-bg.webp` outside the registry for exactly one state,
while Card B cropped one of six atlas scenes by card family and preferred a
person's photo when the card had one. A ground that changes as the card updates
makes the same surface look like a different one each time — the person should
notice the words changed, not the wallpaper.

Only the content layer varies, plus the scrim, which is part of the fixed
treatment because one ground must stay legible under every headline the card
can render.

**Status: installed and proven.** Both PNGs ship at
`public/visuals/home-cards/` (1672x941, verified by reading the file headers and
by looking at them), are listed in `allRegisteredAssets` so the bidirectional
manifest check is authoritative — 12 registered, 12 shipped — and are proven on
real rendered Home by `scripts/hardening/home-static-background-proof.mjs`
(62/62). That proof reads the resolved image URL and natural size out of the
DOM, so a missing file shows as `naturalWidth 0` rather than passing because a
tag exists.

The editorial atlas is gone entirely: entry, resolver and file. Nothing consumed
it once selection stopped depending on state.

**Screenshot review earned its place.** Card A's privacy footnote used
`text-muted-foreground/80` — a token calibrated for a plain surface — and over
the artwork it fell to near invisibility on the one line of that card that must
be readable. Every DOM assertion passed; only looking at the picture found it.

### Query cost

```
HOME BATCH READERS        18 -> 18   (unchanged)
UPFOR CONTEXT STATEMENTS   5 -> 10

  5  existing reads, unchanged
 +3  discovery      friendships, sessions, profiles
       skipped entirely when the viewer has no Muddies
 +2  evidence       conversations (by direct_key), messages (capped, newest first)
       skipped entirely when no accepted UpFor is in play -- the common case

PROVIDER QUERIES          0
N+1                       0   every read is batched over a candidate set
UNBOUNDED HISTORY SCANS   0   capped, newest-first, keyed on indexed columns
```
