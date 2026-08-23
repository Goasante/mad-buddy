# God Mode hardening — continuation report

**Written at the end of session 4.** The next session continues from here.

```
WORKTREE     C:\mb-god
BRANCH       hardening/god-mode-product-pass
HEAD         28a2093
ORIGIN/MAIN  3a42cc06e1506682595de544ca335abc3c110749  (unchanged, nothing pushed)
STATUS       clean
COMMITS      9 local recovery checkpoints, none pushed, nothing deployed
```

## Where the program is

| Mission | Level | State |
| --- | --- | --- |
| 1 — Reliability | Advanced | **COMPLETE** (route audit, auth, control inventory, mutation & journey audit, hydration, test infra, pre-hydration form audit) |
| 1 — Reliability | Extremely Advanced | **PARTIAL** — mutation/duplicate, mid-mutation nav, two-tab consistency, deleted-resource done. Lifecycle sequences (request→cancel→resend, UpFor→Plan→Chat, Event Going→Check In→Linkr→Checkout) NOT done |
| 1 — Reliability | God Mode | not started (click-graph crawl) |
| 2 — UI/UX | Advanced | **PARTIAL** — Profile RESTRUCTURED and verified (MB-GOD-013 fixed: 3.97 -> 2.40 screens, settings share 28.6% -> 0%). Home judged good. 8 surfaces still unaudited: Landing, Auth, Activation, Conversation, Plan detail, Plan Chat, Event detail, Safe Arrival |
| 3 — Flow | all levels | not started (deep-link intent + 10 journeys verified as Mission 1 evidence) |
| 4 — Information architecture | — | **PARTIAL** — Profile restructure DONE, Settings receiving work DONE; **MB-GOD-007 still waiting** |
| 5 — Mobile shell / safe area | Advanced | **complete — no root-cause defect** (MB-GOD-009) |
| 5 — Mobile shell | Extremely Advanced | not started (keyboard, landscape, PWA/Capacitor, sheets/modals/camera) |
| 6 — Security / privacy | — | early evidence gathered (privacy probe passes meaningfully); full pass not started |
| 7 — Landing page | — | not started |
| 8 — Cross-product consistency | — | not started; 44 dead-code eslint warnings waiting |
| FINAL — convergence | — | not started |

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
TESTS       6845 / 6845   (336 files)  — 57s quiet
TSC         PASS
ESLINT      0 errors, 44 warnings (all no-unused-vars dead code)
BUILD       PASS
DIFF CHECK  CLEAN
CRAWL       13/13 authenticated surfaces clean at 393x852
VIEWPORTS   no horizontal overflow at 360/375/390/393/430, light and dark
JOURNEYS    10/10
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

## Things the next session should not re-derive

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
