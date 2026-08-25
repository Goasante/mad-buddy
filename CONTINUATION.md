# Events recovery continuation — after Checkpoint 3

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
