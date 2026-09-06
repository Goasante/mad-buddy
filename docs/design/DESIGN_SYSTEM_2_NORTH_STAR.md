# Mad Buddy — Design System 2.0 North Star

**Status:** design direction, not implementation authority yet  
**Source baseline:** `28ab55b3c828fa097f1c487dfb9a0d547e7b707c`  
**Runtime validation:** pending

This document defines the visual/interaction contract the app-wide convergence pass should work toward. It does **not** authorise a mass CSS rewrite. Existing working primitives should be adapted/migrated incrementally as each surface passes review.

---

## 1. Desired feeling

Mad Buddy should feel:

- warm
- social
- premium
- youthful without being childish
- cinematic where people/media deserve it
- calm where coordination/safety deserve it
- immediate rather than dashboard-heavy
- native-ready
- privacy-conscious without looking clinical

The product should not feel like:

- an enterprise dashboard
- a location tracker
- a generic Tailwind component gallery
- a Tinder clone
- a WhatsApp clone
- a feed-first social network
- a collection of unrelated feature microsites

---

## 2. Brand hierarchy

### Core brand

| Token role | Authority |
| --- | --- |
| Primary identity/action | Orange Grove `#E88C2B` |
| Deep brand accent/ink | Deep Maroon `#4E0401` |
| Default light canvas | Warm Paper `#FEFBF3` |
| Warm dark canvas | current warm dark token family; final rendered value to be runtime-reviewed |

Orange should appear where Mad Buddy is acting, inviting, glowing, connecting or asking for the next step.

Maroon should provide depth, ink, editorial weight and contrast.

Warm Paper should make the product feel human and tactile rather than sterile.

### Semantic colour

Semantic state may use non-brand colour where needed:

- success / arrived → green
- destructive / overdue → red
- neutral / waiting / stale → muted ink/grey
- other status distinctions → reviewed semantic palette

A semantic colour must never become the dominant brand colour of an entire feature.

### User accent customisation

Personal accents may decorate eligible controls/surfaces, but must not recolour:

- safety severity
- privacy warnings
- destructive actions
- canonical brand mark
- core Mad Buddy Orb identity
- verification/trust semantics
- proximity freshness semantics

---

## 3. Canvas and surface hierarchy

The app should use fewer competing nested cards.

### Canvas

The page canvas is the main ground. Most information should sit directly on it unless containment communicates a real relationship.

### Hero surface

Use only when one thing deserves disproportionate attention:

- current Home opportunity
- live Safe Arrival state
- one Linkr candidate
- key activation moment

A page should rarely contain more than one hero surface.

### Standard surface

For grouped content with one local purpose:

- Plan summary
- Event summary
- Settings group
- notification cluster

### Compact/action row

For repeated objects where card chrome would add noise:

- settings rows
- conversation rows
- Muddy rows
- request rows
- secondary plan/event items

### Rule

**Do not put a card inside a card merely to create spacing.** Use layout/typography/dividers first.

---

## 4. Page archetypes

Every consumer route should choose one primary archetype.

### A. Standard page

Use for: Settings, Plans, Notifications, most lists/details.

Structure:

1. safe area
2. canonical header
3. page title/context
4. primary content
5. bottom safe navigation allowance

### B. Immersive decision page

Use for: Linkr and similar single-object decision experiences.

Structure:

1. inline safe-area-aware header
2. full-bleed hero/content
3. fixed/anchored decision controls if required
4. minimal secondary navigation

### C. Conversation/media page

Use for: Messages/chat, media viewers.

Structure:

1. context header
2. full-bleed conversation/media canvas
3. keyboard-safe composer or controls
4. no shell gutters competing with content

### D. Focused setup page/sheet

Use for: create Plan, create UpFor, profile edit, filters.

Structure:

1. clear task title
2. progressive fields/options
3. inline validation
4. one commit action
5. cancel/back without data ambiguity

### E. Safety/status page

Use for: Safe Arrival and other live safety/accountability states.

Structure:

1. status and freshness first
2. responsible people/context second
3. action/extension/confirmation controls
4. details/history last

---

## 5. Typography hierarchy

Exact font family/metrics require rendered review; hierarchy is the authority.

### Display / marketing

Reserved for landing/public storytelling and rare high-emotion product moments.

### Page title

One per destination. Strong but compact enough for mobile.

### Section title

Used to divide real content regions, not every card.

### Object title

Person, Plan, Event, conversation, group.

### Body

Readable default text. Avoid low-contrast tiny copy as the primary way to explain a feature.

### Meta/caption

For time, status, audience, helper text. Must remain accessible and not carry critical meaning by itself.

### Rule

Do not use uppercase + wide tracking as a default way to make interfaces feel premium. Reserve it for short labels/eyebrows where it genuinely helps hierarchy.

---

## 6. Spacing and density

Use a small canonical spacing rhythm rather than feature-local arbitrary gaps.

Direction:

- compact mobile gutters
- generous separation between different ideas
- tighter spacing inside one object
- repeated rows denser than hero/editorial surfaces

A screen should gain breathing room by **removing unnecessary containers**, not only by increasing padding.

Runtime review should derive final token values from 320–430px phones first.

---

## 7. Corners, borders and elevation

Mad Buddy currently uses many rounded surfaces. DS2 should make radius communicate hierarchy rather than become default decoration.

Direction:

- controls: moderate radius
- standard cards: consistent moderate radius
- hero/media: larger radius only where composition benefits
- pills: only for chips/status/compact controls

Borders should be quiet and structural.

Shadows should be sparse. Prefer tonal separation; use elevation for floating sheets, menus, sticky actions and true foreground objects.

---

## 8. Buttons and actions

### Primary

One per local decision state. Brand-forward.

### Secondary

Visible but clearly subordinate.

### Tertiary/text

Navigation, low-risk alternatives, secondary utilities.

### Destructive

Never styled like the primary brand action. Confirmation proportional to consequence.

### Symmetrical choice

Pass/Connect, Accept/Decline and similar paired decisions may share visual weight when the product genuinely has no preferred answer.

### Loading

The control that initiated a mutation owns its in-flight state. Do not disable unrelated actions because background refresh/refill is happening.

---

## 9. Navigation

### Mobile

Current bottom navigation concept remains the working authority:

`Messages | Muddies | Mad Buddy Orb/Home | Linkr | UpFor`

Do not add tabs merely because a feature exists.

### Orb

The Orb is a brand object, not just a circular Home icon. Its animation should remain subtle, periodic and reduced-motion safe.

### Desktop

Desktop may expose more destinations, but should visually preserve primary vs secondary hierarchy rather than present all destinations equally.

### Back

Back should return to product context, not a hardcoded destination. Deep-link cold-entry fallbacks should remain intentional.

---

## 10. Headers

DS2 should converge to a small number of canonical headers matching the page archetypes.

Every route must have exactly one owner for:

- top safe area
- title/context
- back action
- page actions

No route should pay the safe area twice or reserve a fixed header that is not rendered.

The current route exception lists should shrink only when a reviewed archetype can replace them safely.

---

## 11. Sheets, modals and overlays

### Bottom sheet

Preferred on mobile for focused transient tasks:

- filters
- quick controls
- small management actions
- object details that do not deserve navigation

### Full-screen/modal

Use when the task requires concentration or enough vertical space:

- media viewer
- substantial composer
- high-consequence confirmation

### Rule

Avoid stacking a modal over a sheet over another page state. If a transient surface spawns a substantial workflow, promote the workflow to a full destination or replace the current surface.

Inline errors must render inside the surface where the user is looking.

---

## 12. People and avatars

People are central content, not metadata.

Use a small canonical avatar scale:

- tiny: attribution/meta
- small: dense rows
- medium: primary list/person actions
- large: profile/relationship hero
- immersive: Linkr/media-led discovery

Glow belongs around a person when it communicates approved privacy-safe proximity or a deliberate social signal. It should not be applied to generic icons/cards as decoration.

---

## 13. Media

Media should be resolved through canonical product authority and used intentionally.

- Linkr: person/photo is hero
- Events: experience imagery can create desire/context
- Plans/UpFor: curated/category imagery can aid recognition where useful
- Home: media supports the current opportunity; it should not turn Home into a feed
- Messages: user-shared media belongs inside conversation
- Profile: identity/showcase media is owned and manageable

Every text-over-image surface needs a tested scrim/contrast treatment.

---

## 14. Glow language

Glow is one of Mad Buddy's strongest differentiators.

Glow may communicate:

- privacy-safe proximity
- presence/availability where explicitly designed
- brand vitality on the Orb

Glow must not communicate:

- exact distance
- direction
- live route/progress
- certainty when data is stale
- generic “premium” decoration

Stronger glow must always be explainable by a product state, not by an arbitrary visual preference.

---

## 15. Status and freshness

Safety/proximity-sensitive surfaces need explicit status language.

Design states should distinguish where relevant:

- fresh/live
- refreshing/syncing
- cached
- stale
- failed
- offline
- ended

Colour, animation and text should agree. Critical meaning must not depend on motion alone.

---

## 16. Empty states

A good empty state answers:

1. What is empty?
2. Is this normal?
3. What useful thing can I do now?

Do not fill an empty feature with unrelated content merely to make the screen look busy.

Examples:

- zero Muddies → find/invite
- no UpFors → create one / reassure
- no Linkr candidates → honest pool explanation / widen only if truthful
- no Plans → create from a real social context

---

## 17. Loading and optimistic behaviour

Mad Buddy should feel immediate where correctness permits.

Prefer:

- server-seeded first paint
- warm local/cached content
- optimistic reversible actions
- background reconciliation

Avoid:

- skeletons for data already present server-side
- full-page spinners for local mutations
- clearing useful content during refresh
- disabling a whole screen because one background request is running

Safety/security authority is excluded from “optimistic feel” where optimism could communicate a false safe/current state.

---

## 18. Motion

Motion should answer one of four questions:

- Where did this object come from/go?
- What changed?
- What deserves attention?
- Is this status alive/current?

Direction:

- quick feedback: short
- sheet transitions: native-feeling, restrained
- card decisions: direct, momentum-preserving
- ambient brand motion: slow and mostly at rest
- safety motion: calm, non-directional

No continuous decorative animation should compete with content.

Reduced-motion remains mandatory.

---

## 19. Accessibility/non-negotiables

- gesture interactions require control equivalents
- touch targets stay reachable at large text sizes
- focus states visible
- colour never sole critical signal
- contrast verified in rendered context
- labels survive long names/localisation
- screen-reader names describe action, not icon
- safe-area and keyboard behaviour tested on phone layouts
- animation has reduced-motion behaviour

---

## 20. Feature-specific visual north stars

### Home

“One thing worth doing now.”

### Muddies

“People I already care about, with privacy-safe awareness.”

### Linkr

“One person, enough context to decide.”

### UpFor

“Put the intention out there in seconds.”

### Plans

“Know what is happening, what needs a decision, and where coordination lives.”

### Events

“Find an experience, then unlock the right social context around it.”

### Messaging

“Coordinate without losing the context that started the conversation.”

### Safe Arrival

“Private accountability, never tracking.”

### Profile

“Who I am and how I want to be seen.”

### Settings

“How Mad Buddy behaves for me.”

---

## 21. Approval gate for every redesigned surface

A surface is not visually closed until it passes:

1. source/authority review
2. light/dark rendered review
3. compact + standard + large phone review
4. empty/populated/high-density state review
5. error/loading review
6. keyboard/back/sheet review where relevant
7. large-text/accessibility review
8. cross-feature handoff review
9. privacy/status truth review
10. final comparison against adjacent surfaces for consistency

The result can be **KEEP**, **TIGHTEN**, **REDESIGN**, or **REMOVE/DEMOTE**.

“Current implementation exists” is never, by itself, a reason to KEEP.

---

## 22. Implementation discipline

Do not start by rewriting `globals.css`.

For each approved surface:

1. identify existing primitives that already match DS2
2. add/refine the smallest missing canonical primitive
3. migrate that surface
4. prove it visually/runtime
5. remove obsolete local styling only when no caller remains

This prevents a design-system rewrite from becoming a product regression programme.

---

## 23. Current status

**North-star direction:** documented  
**Exact final token metrics:** runtime review pending  
**Component migration:** not started  
**Visual authority:** not yet locked  
**First implementation target after security:** Smart Home Opportunity Ranking + Home hierarchy
