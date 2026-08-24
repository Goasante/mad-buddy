# Continuation checkpoint — after Phase A deploy

**DEPLOYED SHA = 5e66582** (production, `mad-buddy.com`, auto-deployed on push).
Phase A is live. Phase B was NOT started.

## Where things stand

Phase A shipped six items: Circle unread (A1), Circle mentions (A2), stranded
blur (A3), Create Event sideways shift (A4), Circle chat layout (A5), and the
paused-visibility review (A6, which found no defect and was pinned with tests).
Detail and evidence are in `docs/product/BETA-ISSUES.md`.

## Phase B, not started — do these in order

1. Preview my Linkr card actually works.
2. "Hide from specific people" stops routing to Safe Center.
3. Replace the Linkr heart/love mutual icon with a wave/hello.
4. Both users get the mutual "You clicked" state after reciprocity.
5. Say hi opens/reuses a working direct conversation.
6. Fullscreen authorized profile-picture viewing.
7. Fix Glow geometry around avatars.
8. Contact matching: a working supported path, or an honest graceful fallback.
9. Retire PRIVATE Muddy Circles, preserving SHARED Circles/Groups.

**Linkr mutuality rule.** One-sided interest stays private. After reciprocity
BOTH users get the mutual state, may see "You clicked", may press Say hi, and
share one canonical conversation. No notification may reveal who chose first.

**Private Circles retirement, first pass only:** remove the private-circle UI,
filters and settings, stop new writes, PRESERVE legacy rows. Any destructive
cleanup is a separate, later decision.

## How to pick this up

The worktree is `C:\mb-god` on `hardening/god-mode-product-pass`, which
fast-forwards `main`. The local `main` checkout on the Desktop has ~103
uncommitted files and is stale at `6d07b9e` — do not deploy from it.

Local review environment (all local, all disposable):

- `node scripts/hardening/seed-phase-a.mjs` — seeds `phasea@review.local`
  (password `ReviewPass123!`), two Muddies, and a Circle with unread messages.
- Sign in with Playwright and save storage state to `.phasea.json` (gitignored;
  it holds live session cookies, so it must never be committed).
- `npx next build && npx next start -p 3200`, then:
  - `scripts/hardening/phase-a-runtime.mjs` — 51 checks at 360/390/430
  - `scripts/hardening/circle-unread-runtime.mjs` — A1 in a real browser
  - `scripts/hardening/circle-unread-and-mentions.mjs` — A1/A2 against the DB
  - `scripts/hardening/overlay-orphan-invariant.mjs` — the A3 invariant

**Kill any stale server on 3200 before measuring.** A stale process served a
pre-fix build during this session and produced results that looked like
failures of the fix.

## Still open — needs the tester, not more headless probing

BETA-002 and BETA-006 (CSP/realtime; fixed locally, production CSP was always
correct — confirmed again on this deploy). BETA-003 as a separate report from
A3, plus BETA-005, BETA-010 and BETA-016. BETA-014 stays retracted: it was a
rect-only false positive.

Do not spend context proving negatives on the duplicate-search reports or
BETA-014 unless new evidence arrives.

## The rule this program keeps relearning

A rectangle is not reachability, and clipped is not hidden. Hit-test with
`elementFromPoint`. Assert the viewport before any measurement counts. And when
a real-device screenshot disagrees with headless Chromium, the screenshot wins
— read the code for the defect instead of arguing with the evidence.
