# App-wide viewport / scroll matrix

Runtime authority: authenticated local production build at `390x844` in light
and dark for every route, plus representative routes at `360x640`, `360x800`
and `430x932` in both themes. `FIXED` means the route now inherits the bounded
shell and canonical `<main data-app-scroll-owner>` contract. Redirects are
listed as intentional exceptions rather than pretending their source route
renders a page.

| Route | Contract | Before | Result |
|---|---|---|---|
| `/badges` | normal page | document/shell could own overflow | FIXED |
| `/buddy-score` | long page | duplicate bottom reservation produced a large tail | FIXED |
| `/dashboard` | normal page | duplicate nav/launcher reserve produced phantom scroll | FIXED |
| `/discover` | redirect | legacy alias | INTENTIONAL EXCEPTION -- redirects to `/linkr` |
| `/drops` | normal page | document/shell could own overflow | FIXED |
| `/events` | list + sheets | wrong outer scroll owner | FIXED |
| `/events/top` | nested fixed-header page | header ownership depended on broad prefix matching | FIXED |
| `/friends` | list/search | wrong outer scroll owner; focused search could sit behind nav | FIXED |
| `/friends/[username]` | detail | inherited a header it did not render, leaving a blank top band | FIXED |
| `/groups` | list | document/shell could own overflow | FIXED |
| `/groups/[id]` | chat/detail | inherited a header it did not render; shell competed with internal chat | FIXED |
| `/hangout-mode` | immersive | shell could reserve inline-header space twice | FIXED |
| `/help` | informational | wrong outer scroll owner | FIXED |
| `/invite` | compact page | wrong outer scroll owner | FIXED |
| `/invites` | list | wrong outer scroll owner | FIXED |
| `/linkr` | viewport-fit immersive | duplicate activation/nav reserve and launcher collision on short phones | FIXED |
| `/meeting-pings` | creation surface | wrong outer scroll owner | FIXED |
| `/messages` | inbox | shell/document could compete with page flow | FIXED |
| `/moments` | redirect | paused feature | INTENTIONAL EXCEPTION -- redirects to `/dashboard` |
| `/notifications` | list | wrong outer scroll owner | FIXED |
| `/plans` | list + sheets | wrong outer scroll owner | FIXED |
| `/profile` | long form | wrong outer scroll owner and no canonical focus clearance | FIXED |
| `/reminders` | list | wrong outer scroll owner | FIXED |
| `/safe-arrival` | safety surface | wrong outer scroll owner | FIXED |
| `/safety` | redirect | compatibility route | INTENTIONAL EXCEPTION -- redirects to `/dashboard` |
| `/safety-center` | informational | wrong outer scroll owner | FIXED |
| `/scan` | camera-like surface | shell could contribute unrelated page overflow | FIXED |
| `/settings` | long page | wrong outer scroll owner | FIXED |
| `/settings/access` | detail | inherited the Settings child-header rule despite using the global header | FIXED |
| `/settings/appearance` | settings child | wrong outer scroll owner | FIXED |
| `/settings/appearance/wallpaper` | settings child | wrong outer scroll owner | FIXED |
| `/settings/communication` | settings child | wrong outer scroll owner | FIXED |
| `/settings/contact-discovery` | settings child | wrong outer scroll owner | FIXED |
| `/settings/data-storage` | settings child | wrong outer scroll owner | FIXED |
| `/settings/engagement` | settings child | wrong outer scroll owner | FIXED |
| `/settings/feedback` | settings form | wrong outer scroll owner and no canonical focus clearance | FIXED |
| `/settings/glow-visibility` | settings child | wrong outer scroll owner | FIXED |
| `/settings/language` | settings child | wrong outer scroll owner | FIXED |
| `/settings/notifications` | settings child | wrong outer scroll owner | FIXED |
| `/settings/privacy` | settings child | wrong outer scroll owner | FIXED |
| `/settings/privacy-setup` | settings child | wrong outer scroll owner | FIXED |
| `/settings/sessions` | settings child | wrong outer scroll owner | FIXED |
| `/settings/walkthrough` | settings child | wrong outer scroll owner | FIXED |

## Totals

- Authenticated routes found: 43
- Authenticated routes audited: 43
- Fixed: 40
- Already correct: 0
- Intentional redirects: 3
- Not checked: 0

## Evidence

- `.artifacts/viewport-scroll-production-final/`: 43 routes at `390x844`,
  light and dark, top and bottom captures; 86/86 geometry checks passed.
- `.artifacts/viewport-scroll-representative/`: 15 route families across
  `360x640`, `360x800`, `390x844`, and `430x932`, light and dark, top and
  bottom captures; 120/120 geometry checks passed.
- `.artifacts/viewport-scroll-linkr-card/`: pre-fix active Linkr candidate-card
  reproduction across all four viewports and both themes; its compact-screen
  launcher collision led to the `/linkr` exclusion now covered by launcher and
  quick-action regression tests. All 8/8 underlying geometry checks passed.
- `.artifacts/viewport-scroll-interactions-final/`: focused input, modal/sheet
  restoration, and desktop checks; 19/19 passed.
