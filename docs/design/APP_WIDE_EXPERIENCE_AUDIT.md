# Mad Buddy — App-Wide Experience & Visual Convergence Audit

**Status:** SOURCE AUDIT — runtime/visual proof pending  
**Source authority:** `28ab55b3c828fa097f1c487dfb9a0d547e7b707c`  
**Audit branch:** `design/app-wide-experience-audit`  
**Purpose:** understand the product before redesigning it, then converge the consumer experience into one coherent, premium, native-ready system without reopening proven backend/security/lifecycle work.

---

## 1. What this audit is — and is not

This is the first pass of the Mad Buddy Complete Experience & Visual Convergence work.

It is based on repository/source inspection. It maps the current product, its presentation architecture, its strongest interaction models, its accumulated inconsistencies, and the order in which design work should happen.

It is **not** a screenshot review, browser walkthrough, visual regression result, or accessibility certification. Anything that depends on rendered spacing, colour contrast in context, keyboard behaviour, device chrome, scroll behaviour, animation feel, or real data density remains **runtime-review pending**.

No product UI code is changed by this audit.

---

## 2. Product design thesis

Mad Buddy should feel like a social momentum product, not a dashboard of unrelated social tools.

The core user problem is:

> I want to do something with people in real life — right now or soon — and I do not want the friction of organising it.

The experience loop should therefore stay legible across the whole product:

`SEE SOMETHING → EXPRESS INTENT → SOMEONE RESPONDS → COMMIT → MEET → STAY CONNECTED`

The key design word is **Context**.

Mad Buddy already knows useful, privacy-safe context: Muddies, coarse proximity, UpFor intent, Plans, Event attendance/check-in, Event Linkr consent, Linkr intent/interests, conversation context, Safe Arrival state, and profile identity. The UI should surface the strongest truthful piece of that context at the moment it helps a person decide what to do next.

The design should never manufacture context, imply exact location, or make stale safety/proximity data look current.

---

## 3. Brand authority

The brand already has a distinctive direction and should be refined, not replaced.

Core palette:

- Orange Grove `#E88C2B`
- Deep Maroon `#4E0401`
- Warm Paper `#FEFBF3`
- warm dark surfaces rather than blue-black

Current source already contains brand orange/amber/ember/maroon tokens, warm background/foreground tokens, Glow treatments, branded navigation assets, and the Mad Buddy Orb.

### Design rule

**Brand colour and semantic colour must not become the same thing.**

Orange is the action/identity signal. Status colours may still use green/red/blue/violet when they communicate state, but those colours must not turn the product into a purple/blue brand.

The current accent customisation system includes orange, blue, violet, green, red and teal. That is a user-personalisation capability, not permission for core product surfaces to lose the Mad Buddy identity.

---

## 4. Current information architecture

### Public/front door

- Landing
- About
- Public Events
- FAQ
- Invite/deep-link entry
- Privacy
- Safety
- Support
- Terms
- Maintenance/error/not-found states

### Authentication and activation

- Login
- Signup
- Forgot password
- Reset password
- Onboarding
- activation/re-introduction states on Home

### Core social product

- Home / Dashboard
- Muddies
- Muddy profile
- Notifications
- Messages
- Linkr
- UpFor
- Plans
- Events
- Groups
- Moments

### Safety and trust

- Safe Arrival
- Safety Center
- privacy controls
- blocking/reporting
- trusted standing

### Identity and preferences

- Profile
- Settings
- Access
- Appearance / wallpaper
- Communication
- Contact discovery
- Data & storage
- Engagement
- Feedback
- Glow visibility
- Language
- Notifications
- Privacy setup / privacy
- Sessions
- Walkthrough

### Supporting/secondary surfaces

- Invites
- Badges
- Buddy Score
- Reminders
- Drops
- Meeting Pings
- Scan
- Help

There are also lab/prototype routes such as `profile-lab` and `chats-lab`; these must be treated as design evidence, not as a second product authority.

---

## 5. Current shell/navigation architecture

The protected app is wrapped by one shared `AppShell`.

### Mobile navigation

Current persistent mobile destinations are:

- Messages
- Muddies
- centre Mad Buddy Orb → Home
- Linkr
- UpFor

Plans is intentionally surfaced through Home rather than consuming a permanent tab. Profile is reachable through the shared account/menu surface.

This is a strong product decision: the bottom bar is organised around conversation, existing relationships, the product home, discovery, and immediate intent.

### Preserve

The shell contains hard-won fixes that must survive visual convergence:

- safe-area accounting
- 200% text-size resilience
- fixed, reachable touch targets
- full-width mobile constraints
- route prefetch suppression for force-dynamic pages
- feature-gated navigation
- shared account menu
- PWA install/notification prompts
- latency-safe nonblocking wallpaper resolve

### Structural concern

The shell now maintains several route-specific exception sets:

- pages with their own header
- immersive-header pages
- full-bleed pages
- wallpaper pages
- special nested-route header rules

This is evidence of **presentation drift**, even though many individual exceptions are correct.

**Design System 2.0 should reduce the number of screen-specific layout rules by giving routes a smaller set of explicit page archetypes.** It must not remove the safe-area or accessibility fixes that motivated those rules.

Proposed page archetypes:

1. Standard list/detail page
2. Immersive decision page
3. Full-bleed conversation/media page
4. Focused setup/form page
5. Safety/status page

---

## 6. Design-system health

Mad Buddy already has a design system, but it is only partially converged.

### Strong foundations

- brand tokens exist
- shared UI primitives exist
- common app header/page headers exist
- shared modal/sheet primitives exist
- shared avatars and Glow components exist
- icon polish and branded nav assets exist
- reduced-motion support appears repeatedly
- safe-area variables exist centrally
- mobile sizing/accessibility fixes are documented in source

### Main weakness

`app/globals.css` is approximately 299 KB and contains a large amount of feature-specific presentation logic, animations, route treatments and one-off compatibility fixes.

The source itself notes that parts of the newer vocabulary were introduced additively while migration of many existing call sites was deferred.

That means visual convergence should **not** be a mass rewrite. It should establish canonical primitives/tokens and migrate feature surfaces as each feature is reviewed.

### Design System 2.0 should define

- page canvas
- page header archetypes
- title/subtitle scale
- body/caption/meta scale
- section spacing
- card hierarchy: hero / standard / compact / actionable
- sheet hierarchy
- button hierarchy
- icon sizing/stroke rules
- avatar sizes
- image treatment/scrims
- list rows
- filter/tab patterns
- badges/chips/status pills
- empty/loading/error states
- success/feedback patterns
- focus/pressed/disabled states
- elevation and border strength
- motion duration/easing
- Glow usage rules
- native-safe top/bottom insets

---

## 7. Core surface findings

### 7.1 Landing — KEEP THE DIRECTION, TIGHTEN THE EXECUTION

The landing page is already one of the most coherent branded surfaces in the repository.

It has:

- a clear privacy-first hero
- strong orange/maroon/warm-paper identity
- a product mockup rather than abstract decoration
- trust bullets
- a simple Notice → Signal → Make it real story
- explicit Muddies vs Linkr distinction
- privacy explanation
- momentum language around Glow / Wave / UpFor / Plan

The landing page should become one visual reference for the application rather than be independently redesigned from scratch.

Runtime review should focus on: mobile hero density, typography, section length, repeated card styling, dark mode, image quality, CTA hierarchy, and whether public copy reflects the final product vocabulary.

**Priority: P1/P2 polish, not rebuild.**

---

### 7.2 Home — HIGHEST DESIGN LEVERAGE

Home is currently the place where almost every product system can compete for attention.

Its source loads or renders context for:

- activation
- first Muddy
- nearby/glow
- status
- Plans/Events agenda
- Safe Arrival
- profile completion
- Journey/Smart Card
- Buddy Score
- Moments/Air
- ranked Events
- relationship focus
- notifications/requests

This is excellent product data but a dangerous visual composition model.

The design problem is not “make the cards prettier.” It is **decide what deserves the first screen right now.**

### Home north star

Home should answer:

> What is the best social opportunity or obligation for me right now?

Then it should expose supporting context without making every system equal.

Proposed hierarchy:

1. **One primary opportunity / obligation**
2. Nearby Muddies / social presence
3. Upcoming commitments
4. Discovery/supporting content
5. Progress/profile nudges only when they genuinely deserve attention

Safe Arrival may override normal social ranking when a live safety state needs attention.

The existing Smart Card/activation composition should be reused where possible rather than replaced by another parallel engine.

**Priority: P0/P1. First implementation tranche after security closes.**

---

### 7.3 Muddies — RELATIONSHIPS, NOT CONTACT MANAGEMENT

Muddies should visually centre people and relationship state.

The strongest distinctive asset is Glow/proximity, not list management chrome.

Runtime review should test:

- Nearby rail hierarchy
- Glow readability without looking like a map/radar
- add/request states
- profile preview/detail
- wave / say-hi / plan actions
- empty state for zero Muddies
- large Muddy lists
- stale proximity presentation

**Priority: P1.**

---

### 7.4 Linkr — STRONG CORE MODEL; ADD REASON, NOT MORE CHROME

Linkr 2.0 already has a focused interaction model:

- one person as the hero
- full-bleed portrait
- tap to explore photos
- swipe or accessible buttons to decide
- name/age/verification
- intent
- optional Event name
- bio
- up to three interests
- Pass / Connect

The code explicitly rejects filler such as Plans, Groups and a permanent Around You dashboard. Keep that discipline.

The highest-value missing design element is the **strongest truthful reason this person is being shown**.

Examples:

- “Also at Acoustic Night”
- “You both like live music”
- “You’re both open to networking”

Only one reason should lead. Do not stack a résumé of algorithmic explanations.

The same reason should survive:

`candidate → mutual → first conversation`

Event Linkr must continue to require Event eligibility/check-in/consent server-side.

**Priority: P1. No wholesale card redesign.**

---

### 7.5 UpFor — MAKE INTENT FEEL LIGHTWEIGHT

The UpFor product is functionally mature and already supports:

- multiple owner sessions
- now/later-today scheduling
- activity
- audience
- duration
- optional message
- privacy-safe area
- private-by-default discovery scope
- feed/request management
- conversion into Plans

The design challenge is that creation, feed, owned sessions, request management and Plans can make one screen feel managerial.

North star:

> Putting something on UpFor should feel lighter than sending a group message.

Runtime/design work should emphasise the quick-create path and visually demote management complexity until it is needed.

**Priority: P1. Preserve lifecycle and privacy defaults.**

---

### 7.6 Plans — STAGE COMPLEXITY, DO NOT REWRITE THE LIFECYCLE

Plans includes invitations, hosted plans, upcoming plans, unscheduled plans, past plans, RSVP, polls, participants, covers, places, Plan Chat, and closure rules.

The lifecycle is valuable and should remain canonical.

The visual risk is exposing too much lifecycle structure at once. The current five bucket tabs need real phone/runtime review before deciding whether to simplify them.

North star:

- upcoming commitments should be immediately scannable
- invitations should feel actionable
- creation should progressively reveal complexity
- polls should feel attached to a Plan, not like a separate product
- Plan Chat should feel like the coordination room for the commitment

**Priority: P1/P2.**

---

### 7.7 Messaging — PROTECT V4; CONVERGE AROUND IT

Messaging is already on a recent V4 presentation and carries substantial local-first work:

- warm thread cache
- optimistic messages
- realtime reconciliation
- drafts
- failed-send recovery
- presence
- media
- polls
- reactions
- pin/save/forward
- Plan/group context

Do not use the app-wide design pass as an excuse to rebuild Messaging again.

Work here should be limited to:

- shared typography/chrome alignment
- context handoffs from Linkr/Plans/Events
- composer/native keyboard proof
- visual cleanup discovered by runtime review

**Priority: P2 unless runtime exposes a major defect.**

---

### 7.8 Profile — ONE IDENTITY SYSTEM

Profile owns substantial identity and privacy state: media, interests, bio/mood, visibility, field privacy, birthday/age/zodiac visibility, completion, trusted standing and handoff return paths.

The repository also contains `profile-lab`, including edit/media/privacy/people variants.

Before changing `/profile`, compare it against the lab work and explicitly decide which patterns are authority. Do not let two profile design systems survive into Capacitor.

North star:

- identity first
- social context second
- editing clearly separated from viewing
- privacy understandable without reading policy language
- Settings owns account/system configuration

**Priority: P1.**

---

### 7.9 Events / Event Linkr — CONTEXT BRIDGE

Events should not merely be a catalogue. Their unique value inside Mad Buddy is that they create temporary social context.

The key design journey to validate is:

`Event → Going → Check-in → “Meet people here?” → consent → Event Linkr → candidate context → mutual → context-aware chat`

Do not collapse Going, Check-in and Event Linkr consent into one action.

**Priority: P1.**

---

### 7.10 Safe Arrival — STATUS CLARITY OVER VISUAL DRAMA

Safe Arrival already contains careful animation/status semantics in the shared CSS.

Any redesign must preserve:

- no route/map implication
- no exact geography
- stale/failure states that do not look live
- reduced-motion behaviour
- clear state text in addition to colour/motion

A safety state can legitimately outrank normal social content on Home.

**Priority: P0 for correctness, P2 for visual polish.**

---

### 7.11 Settings — REDUCE PERCEIVED FRAGMENTATION

Settings currently spans many separate routes. That may be appropriate technically, but the experience can easily feel like a collection of mini-pages.

The runtime audit should test whether the Settings home provides enough grouping and orientation to make those routes feel like one system.

Likely grouping:

- Account & Access
- Privacy & Safety
- Notifications & Communication
- Appearance
- Data & Devices
- Help & About

Do not move identity-editing controls into Settings merely for neatness; Profile should remain identity-first.

**Priority: P1.**

---

### 7.12 Auth / Onboarding — MATCH THE PROMISE QUICKLY

The auth route set is compact and onboarding is one route, which is a good starting point.

The visual job is to make the transition from landing → signup/login → onboarding → first Home feel like one product.

Onboarding should collect only what is necessary to reach first value and should not front-load secondary settings.

Existing users must not be forced through new-user zero-state onboarding as part of a visual redesign.

**Priority: P1.**

---

## 8. Cross-product issues to solve

### A. Too many local visual dialects

Feature surfaces have evolved independently. The app has strong primitives, but the styling layer contains many feature-specific rules. Design System 2.0 should make the product feel authored by one team.

### B. Header/layout divergence

The app currently needs several route exception lists to decide whether the shell, route, or immersive surface owns the header and safe area.

Goal: fewer archetypes, clearer ownership, no duplicate safe-area payments.

### C. Card inflation

Mad Buddy has accumulated many card-based modules because cards are easy to add safely. Home in particular should stop treating every system as a peer card.

### D. Context often exists but is not carried forward

Linkr/Event/Plans/Messaging already know useful provenance and relationship context. The redesign should carry it across handoffs so the user never asks “why am I here?” or “why am I seeing this person?”

### E. Native chrome is not fully brand-converged yet

The root viewport theme colours currently use cold light/dark values while the product design tokens use warm paper/warm dark surfaces. Before Capacitor store polish, browser/status-bar/native chrome should be aligned deliberately with the final DS2 canvas.

### F. Custom accents need boundaries

User accent themes must not recolour trust/safety meaning or erase brand hierarchy. Brand, semantic status and personal accent need separate contracts.

---

## 9. Design System 2.0 north-star rules

1. One screen, one obvious job.
2. One primary action at a time unless two choices are truly symmetrical.
3. People before controls on social surfaces.
4. Context before explanation.
5. Glow is meaningful social/proximity language, not decoration.
6. Orange is identity/action; status colour remains semantic.
7. Warm paper and warm dark canvases are the default product ground.
8. Use media when it helps recognition or desire; do not wallpaper information-dense pages.
9. Prefer progressive disclosure to large configuration forms.
10. Bottom sheets for focused transient work; full pages for durable destinations.
11. Avoid modal-on-modal journeys.
12. Empty states must propose a real next action, not filler.
13. Loading states must not pretend work is happening when server data already exists.
14. Optimistic interaction should paint immediately when rollback is safe.
15. Safety/privacy state is never optimistic in a way that could mislead.
16. Motion communicates hierarchy/status, not spectacle.
17. Every looping animation must survive reduced motion.
18. Mobile-first dimensions must tolerate large text and safe-area insets.
19. Desktop should feel intentionally expanded, not like a stretched phone.
20. Do not redesign proven server authority to satisfy a visual preference.

---

## 10. Priority matrix

| Surface | Priority | Direction |
| --- | --- | --- |
| Home | P0/P1 | one primary opportunity; reduce competing modules |
| Safe Arrival | P0 correctness | preserve truthful state semantics |
| Global shell/header | P1 | converge page archetypes; preserve safe-area/perf/accessibility |
| Linkr | P1 | shared-context reason + mutual/chat context |
| Events/Event Linkr | P1 | consent timing + context handoff |
| UpFor | P1 | make create/participate light; demote management complexity |
| Profile | P1 | compare current vs profile-lab; establish one authority |
| Settings | P1 | clearer grouped hierarchy |
| Auth/Onboarding | P1 | seamless promise-to-first-value transition |
| Plans | P1/P2 | stage lifecycle complexity; do not rewrite lifecycle |
| Landing | P1/P2 | use as visual reference; tighten rather than replace |
| Muddies | P1 | relationship/Glow-first hierarchy |
| Notifications | P2 | actionability and grouping convergence |
| Messaging V4 | P2 | protect current architecture; shared chrome/context only |
| Groups/Moments/Journey/secondary | P2 | converge after core loop |
| Public legal/help/support | P2 | brand consistency late |
| Admin | out of current consumer pass | separate later if needed |

---

## 11. Do-not-break invariants

The design pass must preserve these product/security truths:

- no exact location or numerical distance
- no live map/history for proximity
- Event Linkr eligibility is server-authoritative
- Linkr mutuality remains private until mutual
- Profile remains media authority for Linkr
- UpFor creation remains additive and edit/end is ID-scoped
- UpFor → Plan uses the canonical Plan lifecycle
- Plan membership/RSVP/Plan Chat authority remains server-side
- Messaging warm cache/realtime/idempotency behaviour remains intact
- Safe Arrival server state remains authority
- feature flags continue to remove paused destinations rather than expose dead UI
- unfinished onboarding guard continues to protect all authenticated entry paths
- mobile large-text and safe-area fixes stay intact
- force-dynamic navigation prefetch remains disabled unless re-measured
- accessibility equivalents remain for gesture-driven controls

---

## 12. Runtime/visual audit plan

Source review cannot judge pixels. The next design review stage should run the real application at minimum across:

- 320×568 compact phone
- 360×800 Android-like phone
- 393×852 iPhone-class phone
- 430×932 large phone
- tablet portrait
- desktop
- light and dark themes
- 100% and 200% text scaling where practical
- reduced motion

For every primary surface capture/review:

- empty state
- normal populated state
- high-density state
- loading/refresh
- inline failure
- permission denied/locked state where relevant
- modal/sheet open
- keyboard open for inputs/chat
- back/dismiss behaviour
- long names/long copy
- no-image fallback
- stale/offline state where relevant

The runtime pass should record **evidence**, not adjectives: screenshot, route, viewport, state fixture, observed problem, severity, proposed correction.

---

## 13. Convergence sequence

The design programme should stay narrow and staged:

1. Finish the already-open final RPC authority hotfix on its separate security branch.
2. Runtime/visual inventory against `SCREEN_INVENTORY.md`.
3. Lock Design System 2.0 primitives and page archetypes.
4. Smart Home Opportunity Ranking + Home hierarchy.
5. Linkr shared-context reason.
6. Linkr mutual → context-aware conversation.
7. Event Linkr consent/context journey.
8. UpFor + Plans hierarchy cleanup.
9. Profile vs profile-lab convergence.
10. Settings/Auth/Onboarding convergence.
11. Muddies/Notifications/supporting surfaces.
12. Messaging/shared-chrome polish only where runtime evidence requires it.
13. Final app-wide visual consistency pass.
14. Web convergence proof.
15. Stop broad web redesign and carry the authority into Capacitor.

---

## 14. Exact next product design action

After the final narrow security hotfix closes, the first implementation should be **Smart Home Opportunity Ranking**, not an app-wide CSS rewrite.

Use the context Home already loads. Introduce a deterministic priority decision that selects the strongest current opportunity/obligation and gives it one primary visual position.

Candidate priority inputs to validate:

- live/attention-needed Safe Arrival
- Plan starting soon
- Event live/starting soon
- Event Linkr opportunity
- active UpFor from a relevant Muddy
- active owned UpFor requiring attention
- new Linkr mutual
- nearby Muddy / relationship action
- activation next step for genuinely early users

The exact ranking must be product-tested; the design requirement is stable:

> Home should lead with one thing worth doing now, not a stack of systems asking for equal attention.

---

## 15. Audit close status

**Source architecture audit:** STARTED / substantial first pass complete  
**Screen inventory:** separate file  
**Runtime walkthrough:** PENDING  
**Visual screenshot review:** PENDING  
**Design System 2.0 implementation:** NOT STARTED  
**Product UI changed by this branch:** NO
