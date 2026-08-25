# Circle/Messaging Tranche 1 — release-ready locally

Head before tranche: `4cd05ec979e8d59f280f882602568b0ecb09cadf`

- Real local Chromium journey: **30/30 PASS**.
- Circle A/B unread proved 3+2 -> open A -> 0+2; Messages aggregate fell by
  exactly 3 and the Unread filter reconciled without refresh.
- Circle mention proved picker, send, sender render, recipient realtime,
  reload persistence, stable user-id metadata and outsider exclusion.
- Circle chat short/long and keyboard-resize geometry passed at 360x800,
  390x844 and 430x932.
- Fixes in this tranche: reconcile the cached Messages row list whenever the
  inbox mounts; size mobile Circle chat from the actual visual viewport and
  rendered mobile navigation rather than a 320px minimum.
- Security invariants remain canonical: read cursor updates are scoped by both
  conversation id and signed-in user id; mention enumeration and persistence
  require joined membership; conversation access is rechecked server-side.
- Tests: focused 84/84; full suite 7140/7140. Production build, standalone TSC
  and focused ESLint pass. Focused security review: Critical 0 / High 0.
- No production data was created or modified for browser evidence.

Release sequence remaining at the time of this note: commit -> push -> deploy
-> verify the live `/api/version` SHA -> public production smoke. Only then
move to Linkr Tranche 2 in `C:/mb-linkr-t2`; preserve its existing commits and
do not rebuild that work from scratch.

# Events recovery continuation — Checkpoint 4 runtime prepared, Browser blocked

Branch: `fix/events-recovery`

Production baseline observed on 2026-08-25:

- `mad-buddy.com/api/version` build `dpl_DWCeEiLaRUGJdPPshWGYSuLMkuzY`
- commit `42901a6fc19649a9470b45cc0cbe552ffbcaa823`
- fetched `origin/main` matched that commit exactly

## Completed checkpoints

1. Events shell + overlay invariant + Create Event geometry (`b5743c3`)
   - shared Modal fails closed when its foreground payload is null
   - sheet Back listener holds one history sentinel per opening, not one per render/keystroke
   - Create Event time controls use zero-minimum grid tracks; the clipping mask was removed
2. Publish/discovery audience + RSVP/check-in authority (`c973308`)
   - RSVP and check-in use `getEventForViewer`, so real invitees work and community outsiders fail closed
   - Community requires a selected Circle and joined membership; untargeted legacy rows are no longer broad
   - create/edit revalidate community targets as joined group conversations server-side
3. Live/Updates admin authority (`2998817`)
   - delegated Event admins now see the Updates composer through canonical server authority

## Verification completed

- Checkpoint 1 targeted tests: 101 passed
- Original full Events domain before authority changes: 685 passed
- Audience/RSVP/check-in/sharing affected suite after changes: 214 passed
- Updates/live affected suite: 108 passed
- TypeScript: passed
- focused ESLint: passed
- production build: passed after every committed checkpoint (81 static pages generated)

One subsequent full-domain Vitest invocation stalled before emitting output and was terminated; focused affected suites passed afterward. Do not report this as a full-suite pass after Checkpoint 2.

## Previously blocked interactive scope (resolved below)

The Browser runtime exposed no in-app or extension browser (`agent.browsers.list()` returned `[]`). No signed-in interactive session or screenshots were available. Therefore these remain explicitly unverified:

- actual UI Create → Publish → Reopen
- 360×800, 390×844 and 430×932 screenshots in both themes
- rapid taps, animation-time Back, background/foreground
- two-person Event Linkr mutual → Say hi → same direct chat

Do not call any of these production-verified. Resume with an available signed-in Browser surface and run the existing Events modal/runtime probes plus the controlled Host/A/B/Unauthorized journey.

## Previous next checkpoint (completed below)

Event Linkr end to end, then security review and release. Do not push or deploy until the interactive journey and full release gates pass.

## Checkpoint 4 local-runtime preparation (2026-08-25)

- Restored the Docker-backed local Supabase stack at `127.0.0.1:54321`; no production Supabase session or account was used.
- Applied all pending migrations locally without resetting the database.
- Verified local Auth for Host (`qa@local.test`), Attendee A (`kofi@local.test`), Attendee B (`ama@local.test`), and the unauthorized outsider (`saa@local.test`).
- Verified the local Next.js runtime answers `/login` on port 3200.
- Event authority runtime sequence passed 9/9.
- The Linkr runtime sequence initially failed its simultaneous reciprocal-connect assertion (6/7): both calls committed private actions but neither created the connection.
- Added `20260825120000_linkr_connect_race_lock.sql`, which serializes only the canonical user pair with a transaction advisory lock before recording interest.
- After applying that migration locally, the real Postgres Linkr runtime sequence passed 7/7, including simultaneous reciprocal connects producing exactly one connection.
- Focused Linkr unit/migration suite passed 62/62; TypeScript passed.

The in-app Browser connector still returned `No browser is available` for `http://127.0.0.1:3200` at this preparation checkpoint. The interactive work below supersedes that limitation by using standalone Playwright against the real local application.

## Checkpoint 4 interactive completion (2026-08-25)

- Standalone Playwright drove four independent authenticated browser contexts: Host, Attendee A, Attendee B, and Outsider.
- The clean built local runtime completed the full Event -> Event Linkr -> canonical chat -> Event end journey: 37/37 assertions passed, with no browser page errors or HTTP 5xx responses.
- Outsider access failed closed; A's first Connect leaked no one-sided interest to B; reciprocal Connect produced mutual state for both users.
- `Say hi` opened canonical conversation `082a631e-fa08-42e8-abf4-a868b9537436`; both directions sent successfully; the relationship and both messages survived Event end while Event Linkr discovery ended.
- Visual evidence includes 22 screenshots at 390x844 plus 360x800 and 430x932 overflow checks, light/dark Create Event coverage, and four Playwright traces under `.hardening/events-e2e/latest/`.
- Real defects found and repaired: post-publish `View event` was clipped on mobile; check-in left Event Linkr eligibility stale; Turbopack could not resolve the constructed consent-module import; notification relative times could disagree during hydration.
- Current gates: focused Event/Linkr/notification tests 54/54, TypeScript pass, focused ESLint pass, optimized production build pass.
- Production was not touched. Nothing was pushed or deployed.

Release decision: Checkpoint 4 is approved locally. Keep the production release on hold until an explicit push/deploy instruction is given.
