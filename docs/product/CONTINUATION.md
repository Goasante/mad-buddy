# God Mode hardening — continuation report

**Written at the end of session 2.** The next session continues from here.

```
WORKTREE     C:\mb-god
BRANCH       hardening/god-mode-product-pass
HEAD         30fd3b5
ORIGIN/MAIN  3a42cc06e1506682595de544ca335abc3c110749  (unchanged, nothing pushed)
STATUS       clean
COMMITS      3 local recovery checkpoints, none pushed, nothing deployed
```

## Where the program is

| Mission | Level | State |
| --- | --- | --- |
| 1 — Reliability | Advanced | **substantially complete** (route audit, auth/authorization, control inventory, mutation & journey audit, hydration, test infrastructure) |
| 1 — Reliability | Extremely Advanced | not started |
| 1 — Reliability | God Mode | not started |
| 2 — UI/UX | all levels | not started (touch-target work done, but that is ergonomics, not the design review) |
| 3 — Flow | all levels | not started (deep-link intent + 10 journeys verified as Mission 1 evidence) |
| 4 — Information architecture | — | not started; **MB-GOD-007 waiting here** |
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
TESTS       6836 / 6836   (335 files)  — 80s quiet, 106s under build load
TSC         PASS
ESLINT      0 errors, 44 warnings (all no-unused-vars dead code)
BUILD       PASS
DIFF CHECK  CLEAN
CRAWL       13/13 authenticated surfaces clean at 393x852
VIEWPORTS   no horizontal overflow at 360/375/390/393/430, light and dark
JOURNEYS    10/10
```

## Open items, in the order they should be picked up

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
