# Mad Buddy — Consumer Screen & State Inventory

**Source authority:** `28ab55b3c828fa097f1c487dfb9a0d547e7b707c`  
**Audit branch:** `design/app-wide-experience-audit`  
**Purpose:** give the visual/runtime audit one canonical checklist so screens are reviewed as a product, not as isolated screenshots.

## Status legend

- **SRC ✓** — source structure inspected in the first audit
- **SRC map** — route/component presence mapped; deeper source review still useful
- **RUNTIME ☐** — rendered/browser review still pending
- **LAB** — prototype/comparison surface; not production design authority by itself
- **LEGACY** — retained compatibility/redirect/rollback surface; do not redesign as a primary destination without confirming it is still user-facing

This file is intentionally consumer-focused. Admin is excluded from the current app-wide visual convergence pass.

---

## A. Public front door

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Landing | `/` | SRC ✓ | ☐ | Does the public promise match the product and set the visual north star? |
| About | `/about` | SRC map | ☐ | Does it feel part of the same public system? |
| Public Events entry | `/events` public tree | SRC map | ☐ | Is public event discovery clearly separated from signed-in social context? |
| FAQ | `/faq` | SRC map | ☐ | Scanability and brand consistency |
| Invite/deep-link entry | `/invite` | SRC map | ☐ | Is the inviter/context obvious before auth handoff? |
| Privacy | `/privacy` | SRC map | ☐ | Trust-first, readable, not legal-looking by default |
| Safety | `/safety` | SRC map | ☐ | Does safety language support the product without fear-heavy presentation? |
| Support | `/support` | SRC map | ☐ | Can a person reach help quickly? |
| Terms | `/terms` | SRC map | ☐ | Public shell consistency |
| Maintenance | `/maintenance` | SRC map | ☐ | Clear state, retry/return expectations |
| Not found | global | SRC map | ☐ | Useful recovery |
| Global error | global | SRC map | ☐ | Useful recovery without leaking internals |

### Landing states to capture

- compact phone hero
- large phone hero
- desktop hero
- dark mode
- long page / all sections
- CTA transition to signup/login
- reduced motion

---

## B. Authentication & onboarding

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Login | `/login` | SRC map | ☐ | Does it visually continue the landing promise? |
| Signup | `/signup` | SRC map | ☐ | Is account creation short and confidence-building? |
| Forgot password | `/forgot-password` | SRC map | ☐ | Recovery clarity |
| Reset password | `/reset-password` | SRC map | ☐ | Recovery clarity |
| Onboarding | `/onboarding` | SRC map | ☐ | Minimum-to-value, not settings collection |

### Auth/onboarding states

- default
- invalid field
- server failure
- password manager/autofill
- OAuth return where applicable
- keyboard open
- long email/name
- interrupted onboarding resumed through protected layout
- existing complete user should not be forced through zero-state onboarding

---

## C. Global protected shell

| Surface | Route/owner | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| App shell | protected layout | SRC ✓ | ☐ | One coherent page grammar across routes |
| Mobile bottom nav | shell | SRC ✓ | ☐ | Messages / Muddies / Orb / Linkr / UpFor balance |
| Desktop navigation | shell | SRC ✓ | ☐ | Does expanded IA stay understandable? |
| Account/menu sheet | shell | SRC ✓ | ☐ | Identity + settings navigation without becoming a second Home |
| Quick actions | shell/Home | SRC map | ☐ | Useful shortcuts vs duplicate navigation |
| Install prompt | shell | SRC map | ☐ | Non-intrusive PWA handoff |
| Notification enable prompt | shell | SRC map | ☐ | Asked at a meaningful moment |
| Guided tours | shell | SRC map | ☐ | Teach without blocking experienced users |

### Shell proof matrix

- 320px wide
- 360px wide
- 393px wide
- 430px wide
- 200% text scaling
- notch/safe-area
- dark/light
- keyboard open
- route with own header
- immersive route
- full-bleed route
- nested detail route

---

## D. Home / adaptive orchestration

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Home | `/dashboard` | SRC ✓ | ☐ | What is the one best thing to do now? |
| Activation card | Home | SRC ✓ | ☐ | Early-user next step without hiding real value |
| First Muddy success | Home | SRC ✓ | ☐ | Turn first relationship into conversation/Plan |
| Nearby Muddies rail | Home | SRC ✓ | ☐ | People + Glow lead; no map implication |
| Status composer | Home | SRC ✓ | ☐ | Lightweight and contextual |
| Smart Card / Journey | Home | SRC ✓ | ☐ | Does it compete with higher-value current context? |
| Plans/Events agenda | Home | SRC ✓ | ☐ | Commitments are scannable |
| Ranked Events preview | Home | SRC ✓ | ☐ | Discovery does not overpower social obligations |
| Safe Arrival Home cards | Home | SRC ✓ | ☐ | Safety priority when live/attention-needed |
| Moments/Air preview | Home | SRC ✓ | ☐ | Supporting content, not feed takeover |
| Profile completion | Home | SRC ✓ | ☐ | Only when useful, not permanent nagging |

### Home fixture set

1. brand-new user
2. one Muddy, no location permission
3. multiple Muddies, nobody nearby
4. nearby Muddy
5. active UpFor opportunity
6. owned UpFor needs attention
7. Plan starting soon
8. live Event / Event Linkr opportunity
9. new Linkr mutual
10. Safe Arrival travelling
11. Safe Arrival invitation/check-on state
12. mature/high-density account with several simultaneous opportunities

This fixture set is required before approving Smart Home ranking.

---

## E. Muddies / relationship surfaces

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Muddies | `/friends` | SRC map | ☐ | Relationships, not contact-management chrome |
| Muddy profile | `/friends/[username]` | SRC map | ☐ | Enough context + clear actions |
| Add/request Muddy | Muddies flows | SRC map | ☐ | Request state is obvious |
| Nearby/Glow state | Muddies/Home | SRC map | ☐ | Coarse proximity is legible but private |
| Zero Muddies | `/friends` | SRC map | ☐ | Find/invite next action |

States: nearby, stale proximity, hidden/ghost, pending incoming, pending outgoing, blocked/unavailable, long list, no avatar.

---

## F. Linkr / discovery

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Linkr discovery | `/linkr` | SRC ✓ | ☐ | Person is hero; decision is obvious |
| Candidate card | `/linkr` | SRC ✓ | ☐ | Enough identity/context without résumé density |
| Filters | Linkr view | SRC ✓ | ☐ | Useful control, not configuration burden |
| Linkr off/activation | Linkr view | SRC ✓ | ☐ | Clear why/when to turn it on |
| Profile editor handoff | Linkr/Profile | SRC ✓ | ☐ | Preserve user intent and return smoothly |
| Linkr settings | Linkr view | SRC ✓ | ☐ | Privacy/discovery controls understandable |
| How Linkr works | Linkr view | SRC ✓ | ☐ | Teach mutuality simply |
| Clicked/collections | Linkr view | SRC ✓ | ☐ | Revisit connections without turning into inbox duplication |
| Mutual screen | Linkr view | SRC ✓ | ☐ | Context-aware Say hi; optional Plan |
| Mutual banner | Linkr view | SRC ✓ | ☐ | Non-disruptive reciprocity |
| Event Linkr intro | `/linkr?eventId=…` | SRC ✓ | ☐ | Why this pool exists is clear |
| Event Linkr deck | `/linkr?eventId=…` | SRC ✓ | ☐ | Event/shared context visible |
| Empty deck | Linkr | SRC ✓ | ☐ | Honest next action, no filler |

### Required context variants

- ordinary Linkr, shared intent
- shared interest
- Event Linkr
- no strong shared reason beyond eligibility
- mutual before conversation exists
- mutual where conversation already exists

---

## G. UpFor / real-time intent

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| UpFor feed | `/hangout-mode` | SRC ✓ | ☐ | See relevant intent immediately |
| Quick create | UpFor | SRC ✓ | ☐ | Lighter than sending a group message |
| Create scheduled later today | UpFor | SRC ✓ | ☐ | Scheduling stays lightweight |
| Owned UpFors | UpFor | SRC ✓ | ☐ | Multiple sessions are legible |
| Owner management | UpFor | SRC ✓ | ☐ | Requests/status without managerial overload |
| UpFor detail | UpFor | SRC ✓ | ☐ | Join/request state obvious |
| Request response | UpFor | SRC ✓ | ☐ | Accept/decline directness |
| UpFor → Plan | UpFor/Plans | SRC ✓ | ☐ | Commitment transition feels natural |
| Upcoming Plans on UpFor | UpFor | SRC ✓ | ☐ | Supporting context, not competing product |
| Access-limited state | UpFor | SRC ✓ | ☐ | Free Muddy/owned-session access remains clear |

States: no feed, multiple owned sessions, pending requests, accepted requests, expired, scheduled, active-now, around/other discovery modes, offline/refresh failure.

---

## H. Plans

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Plans list | `/plans` | SRC ✓ | ☐ | Commitment status is immediately scannable |
| Upcoming bucket | `/plans` | SRC ✓ | ☐ | Default useful view |
| Invitations bucket | `/plans` | SRC ✓ | ☐ | Actionable invites |
| Created by you | `/plans` | SRC ✓ | ☐ | Host responsibilities without clutter |
| No date yet | `/plans` | SRC ✓ | ☐ | Unscheduled does not disappear |
| Past | `/plans` | SRC ✓ | ☐ | History without crowding current life |
| Create Plan | `/plans?create=1` | SRC ✓ | ☐ | Progressive disclosure |
| Plan detail | `/plans/[planId]` / modal entry | SRC map | ☐ | One authoritative detail hierarchy |
| RSVP | Plan surfaces | SRC ✓ | ☐ | Immediate, reversible-looking only when server accepts |
| Poll | Plan | SRC ✓ | ☐ | Feels embedded in coordination |
| Participant/invite management | Plan | SRC ✓ | ☐ | Host-only complexity appears on demand |
| Plan Chat handoff | Plan/Messages | SRC ✓ | ☐ | Coordination room is easy to enter |

Special review: five bucket tabs on 320–393px; long titles; no cover; large participant lists; undated plans; cancelled/completed plans.

---

## I. Events

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Events | `/events` protected route | SRC map | ☐ | Experience discovery vs Plans clearly distinguished |
| Top Events | `/events/top` | SRC map | ☐ | Ranking useful, not feed noise |
| Event detail | Event route/sheets | SRC map | ☐ | Going/check-in/social opportunity hierarchy |
| Going | Event | SRC map | ☐ | Commitment state clear |
| Check-in | Event | SRC map | ☐ | Separate from RSVP |
| Event Linkr consent | Event | SRC map | ☐ | Explicit “Meet people here?” moment |
| Event Linkr handoff | Event → Linkr | SRC ✓ | ☐ | Event context survives |

Do not visually collapse Going, Check-in and Event Linkr consent into one state.

---

## J. Messaging

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Chats inbox V4 | `/messages` | SRC ✓ | ☐ | Fast scan, useful filters, no WhatsApp-clone clutter |
| Direct chat | `/messages?conversation=…` | SRC ✓ | ☐ | Calm coordination surface |
| Group chat | Messages | SRC ✓ | ☐ | Presence/members without header overload |
| Plan chat | Messages | SRC ✓ | ☐ | Plan provenance obvious |
| Composer | Messages | SRC ✓ | ☐ | Native keyboard-safe, low-friction |
| Voice note | Messages | SRC ✓ | ☐ | Press/record states understandable |
| Media viewer | Messages | SRC ✓ | ☐ | Immersive/back behaviour |
| Poll | Messages | SRC ✓ | ☐ | Embedded interaction |
| Message actions | Messages | SRC ✓ | ☐ | React/reply/forward/save/delete hierarchy |
| Chat settings | Messages | SRC ✓ | ☐ | Settings secondary to conversation |
| Warm cached reopen | Messages | SRC ✓ | ☐ | No flash/spinner regression |
| Failed/offline send | Messages | SRC ✓ | ☐ | Failure/retry understandable |
| `chats-lab` | `/chats-lab` | LAB | ☐ | Comparison only; not parallel authority |

Messaging redesign is not a priority unless runtime evidence reveals a concrete UX defect.

---

## K. Safe Arrival & safety

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Safe Arrival | `/safe-arrival` | SRC map | ☐ | Current status unmistakable |
| Start journey | Safe Arrival | SRC map | ☐ | Clear privacy contract |
| In transit | Safe Arrival | SRC map | ☐ | Active without route/progress implication |
| Extended | Safe Arrival | SRC map | ☐ | Extension acknowledged clearly |
| Grace/waiting | Safe Arrival | SRC map | ☐ | Needs attention without panic theatre |
| Arrived | Safe Arrival | SRC map | ☐ | Successful closure |
| Cancelled/expired | Safe Arrival | SRC map | ☐ | Ended state visibly ended |
| Contact invitation | Home/Safe Arrival | SRC map | ☐ | Accept/decline clear |
| Checking on someone | Home/Safe Arrival | SRC map | ☐ | Accountability without tracking |
| Safety Center | `/safety-center` | SRC map | ☐ | Actions/findability |

Mandatory review dimensions: reduced motion, stale state, network failure, background/resume later in Capacitor.

---

## L. Profile / identity

| Surface | Route | Source | Runtime | Design question |
| --- | --- | --- | --- | --- |
| Profile | `/profile` | SRC ✓ | ☐ | Identity first, controls second |
| Profile edit | Profile | SRC ✓ | ☐ | Editing clearly distinct from viewing |
| Profile media | Profile | SRC ✓ | ☐ | Avatar + showcase management understandable |
| Interests | Profile | SRC ✓ | ☐ | Useful social context, not tag wall |
| Completion | Profile | SRC ✓ | ☐ | Helpful, not gamified pressure |
| Birthday/age/zodiac privacy | Profile | SRC ✓ | ☐ | Plain-language privacy |
| Trusted standing | Profile | SRC ✓ | ☐ | Trust signal explained without bureaucracy |
| Linkr handoff/return | Profile | SRC ✓ | ☐ | Preserve activation intent |
| Profile lab | `/profile-lab` subtree | LAB | ☐ | Compare patterns; choose one authority |

Before changing production Profile, explicitly compare the lab variants and retire duplicated design authority conceptually.

---

## M. Settings

Primary settings route plus mapped descendants:

- `/settings`
- `/settings/access`
- `/settings/appearance`
- `/settings/wallpaper`
- `/settings/communication`
- `/settings/contact-discovery`
- `/settings/data-storage`
- `/settings/engagement`
- `/settings/feedback`
- `/settings/glow-visibility`
- `/settings/language`
- `/settings/notifications`
- `/settings/privacy-setup`
- `/settings/privacy`
- `/settings/sessions`
- `/settings/walkthrough`

**Source:** SRC map  
**Runtime:** ☐

### Review goal

Determine whether Settings reads as one grouped system rather than a collection of mini-products. Evaluate grouping around:

1. Account & Access
2. Privacy & Safety
3. Notifications & Communication
4. Appearance
5. Data & Devices
6. Help & About

Do not move public identity management out of Profile simply to reduce Settings routes.

---

## N. Supporting social/content surfaces

| Surface | Route | Source | Runtime | Priority note |
| --- | --- | --- | --- | --- |
| Groups | `/groups` | SRC map | ☐ | P2 after core loop |
| Group detail | `/groups/[id]` | SRC map | ☐ | P2 |
| Moments | `/moments` | SRC map | ☐ | Feature-gated; P2 |
| Notifications | `/notifications` | SRC map | ☐ | P2, actionability/grouping |
| Buddy Score | `/buddy-score` | SRC map | ☐ | Supporting progress only |
| Badges | `/badges` | SRC map | ☐ | Supporting progress only |
| Reminders | `/reminders` | SRC map | ☐ | P2 |
| Invites | `/invites` | SRC map | ☐ | Growth loop, P2 |
| Invite | `/invite` protected flow | SRC map | ☐ | Growth loop, P2 |
| Drops | `/drops` | SRC map | ☐ | Confirm product role before polish |
| Meeting Pings | `/meeting-pings` | SRC map | ☐ | Confirm product role before polish |
| Scan | `/scan` | SRC map | ☐ | Native camera/deep-link implications later |
| Help | `/help` | SRC map | ☐ | P2 |
| Discover | `/discover` | LEGACY / feature-gated | ☐ | Confirm redirect/compatibility role; do not make second Linkr |

---

## O. Camera / native-adjacent surfaces

Mad Cam is feature-gated and lazy-loaded from the shell. Camera code should not be pulled into normal Home rendering when disabled.

Runtime review later should include:

- launch from Home/orb when enabled
- camera permission denied
- photo picker/camera distinction
- keyboard/sheet dismissal interactions
- safe-area/full-screen media
- resume after native interruption

These are better finalised during Capacitor after the consumer visual authority is stable.

---

## P. Required app-wide visual checks

For every consumer surface that ships, the final convergence pass must answer:

- Is the page's job obvious within one glance?
- Is there one visually dominant action?
- Are secondary actions genuinely secondary?
- Does the surface use the canonical page archetype?
- Does it have one safe-area owner?
- Is the header consistent with its archetype?
- Does typography match DS2?
- Are cards/lists/sheets from the canonical hierarchy?
- Are icons stylistically consistent?
- Does the warm brand canvas survive light/dark?
- Is Glow meaningful rather than decorative?
- Is private context phrased without revealing exact location?
- Are empty/loading/error states real and useful?
- Is 200% text still navigable?
- Is keyboard behaviour safe?
- Does back/dismiss return to the correct product context?
- Does a cross-feature handoff explain why the user arrived there?
- Does the screen remain understandable with long names, no images and dense data?

---

## Q. Runtime audit output format

Each runtime finding should be recorded as:

```text
ROUTE / SURFACE:
VIEWPORT:
THEME:
ACCOUNT FIXTURE / STATE:
OBSERVED:
WHY IT MATTERS:
SEVERITY: P0 / P1 / P2
PROPOSED DIRECTION:
SCREENSHOT / EVIDENCE:
SOURCE OWNER:
```

No screen should be marked visually approved from source review alone.

---

## Current close status

**Route inventory:** first consumer map complete  
**Deep source review:** Landing, shell, Home, Linkr, UpFor, Plans, Messaging, Profile  
**Runtime/browser walkthrough:** PENDING  
**Screenshot-based visual review:** PENDING  
**Design changes on this audit branch:** NONE
