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

## Runtime blocker

The Browser runtime exposed no in-app or extension browser (`agent.browsers.list()` returned `[]`). No signed-in interactive session or screenshots were available. Therefore these remain explicitly unverified:

- actual UI Create → Publish → Reopen
- 360×800, 390×844 and 430×932 screenshots in both themes
- rapid taps, animation-time Back, background/foreground
- two-person Event Linkr mutual → Say hi → same direct chat

Do not call any of these production-verified. Resume with an available signed-in Browser surface and run the existing Events modal/runtime probes plus the controlled Host/A/B/Unauthorized journey.

## Next checkpoint

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

The in-app Browser connector still returns `No browser is available` for `http://127.0.0.1:3200`. That is the single remaining execution blocker for the required interactive Create/Publish/Reopen, RSVP/check-in, Event Linkr UI, canonical chat, end-event persistence, and responsive light/dark screenshot pass. Standalone Playwright was not used because the Browser skill requires the selected Browser surface rather than a fallback browser runtime.
