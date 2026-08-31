# Mad Buddy Product Constitution

Status: Canonical product architecture  
Repository baseline reviewed: `8a4453e22bfb12fa7dc11d0dcee29e9fd4d36cf1`  
Review date: 14 August 2026  
Scope: Product purpose, feature roles, transitions, terminology, and invariants. This document describes current implementation truth and the intended architecture. It does not itself authorize implementation work.

## 1. Mad Buddy's purpose

Mad Buddy helps people understand which approved friends are around, decide what they want to do, coordinate it, meet in real life, and strengthen those relationships without exposing exact location.

Mad Buddy is a private, real-world social coordination product. Its centre is the movement from an approved relationship to a safe proximity signal, then to communication, coordination, an in-person experience, and stronger relationship context.

Mad Buddy is not primarily:

- a content feed;
- a camera app;
- a generic messenger;
- a calendar;
- an Events marketplace;
- a public popularity network;
- a social-media clone.

Every significant product decision should either strengthen the core social loop, safely support it, or be kept outside the primary experience.

## 2. Core user promise

The core promise is:

> Know when approved friends are around, connect or make a plan, and meet safely without sharing exact location.

The promise has five parts:

1. **Approved relationships:** A Muddy relationship is mutual and deliberate.
2. **Private proximity:** Friends receive safe labels and glow states, not coordinates or exact distance.
3. **Low-friction intent:** A user can signal that they want to connect without creating a formal event.
4. **Useful coordination:** Messages, Plans, Circles, Events, and Safe Arrival help people act in real life.
5. **Long-term relationship value:** Journey, Buddy Score, Achievements, identity, and recaps reflect meaningful participation rather than screen time.

Core relationship formation and core communication must work on the Free tier. Premium can extend capacity, expression, control, or convenience, but cannot make the network functional.

## 3. Core loop

The canonical loop is:

```text
FIND OR ALREADY HAVE A PERSON
  -> APPROVE A MUDDY RELATIONSHIP
  -> RECEIVE A SAFE PROXIMITY / GLOW SIGNAL
  -> COMMUNICATE OR SIGNAL INTENT
  -> MAKE OR JOIN SOMETHING
  -> COORDINATE
  -> MEET IN REAL LIFE
  -> USE SAFETY, PRESENCE, OR COMPLETION TO CLOSE THE LOOP
  -> STRENGTHEN THE RELATIONSHIP AND PROGRESS
  -> REPEAT
```

The loop does not require every feature on every pass. For example, two existing Muddies may move directly from Glow to Messages to a Plan. A Linkr discovery must first become an approved relationship before it receives the normal Muddy privileges. Safe Arrival is available when useful, not a compulsory gate to meeting.

A feature that cannot state which step it starts, which step it completes, and what comes next is not a core-loop feature.

## 4. Product layers

### Layer 1: People

Question answered: **Who?**

- **Muddies:** approved friendship network.
- **Linkr:** opt-in discovery of new people.
- **Circles:** either private audience organisation or shared communities, subject to the terminology correction in section 13.
- **Proximity / Glow:** safe, derived awareness that an approved friend is around.

### Layer 2: Intent

Question answered: **Should we connect, and what do we feel like doing?**

- **UpFor:** short-lived availability or activity intent.
- **Wave:** lightweight acknowledgement or hello between existing Muddies.
- **Meeting Ping:** directed, expiring invitation to meet, where its premium role remains justified.
- **Messaging initiation:** direct communication when more context is needed.

### Layer 3: Coordination

Question answered: **What are we doing, and how do we coordinate it?**

- **Plans:** small, usually private commitments.
- **Messages:** canonical conversation system.
- **Plan Chat:** a Plan-bound Messages context, not a separate messenger.
- **Events:** hosted and potentially discoverable attendance experiences.
- **Circle Chat:** a Circle-bound Messages context, not a separate messenger.
- **Safe Arrival:** privacy-preserving journey status and arrival confirmation.

### Layer 4: Experience and relationship

Question answered: **What has our real-world social life become over time?**

- **Journey:** ordered activation and feature-learning path.
- **Buddy Score:** long-term reputation based on healthy, confirmed participation.
- **Achievements:** factual, categorical milestones.
- **Recaps:** retrospective summaries.
- **Identity and personalisation:** profile, effective membership, badges, birthday-derived identity, and presentation.

### Cross-cutting support

- **Home:** orchestration, not a separate product layer.
- **Notifications / Pulse:** response and awareness routing, not a content feed.
- **Invite / QR and Contact Discovery:** growth paths into an approved Muddy relationship.
- **Media:** an attachment capability inside communication contexts.
- **Admin, moderation, feature controls, entitlements, analytics, and jobs:** infrastructure and governance rather than user-facing product layers.

## 5. Feature role registry

| Feature | Primary job | Starting condition | Successful end state | It should not do | What should come next | Current authority / evidence |
|---|---|---|---|---|---|---|
| **Home** | Orchestrate the returning user's most relevant people, commitments, responses, and next action. | Authenticated user opens the app. | The user understands who is around, what needs attention, what is next, or one useful thing they could do. | Become a feature catalogue, billing dashboard, or duplicate feed. | Nearby Muddy, response, Plan/Event, Safe Arrival, or one contextual suggestion. | `app/(app)/dashboard/page.tsx`; `components/dashboard/dashboard-page.tsx`; `lib/smart-card/*`. |
| **Muddies** | Maintain the user's mutually approved friendship network. | A user finds, invites, or receives a request from another account. | Both users have an approved relationship that can use proximity, messaging, and coordination. | Become stranger discovery or imply approval from one-sided following. | Glow, Wave, Message, Plan, Safe Arrival, or audience organisation. | Friend request/friendship services and Friends surfaces; privacy filters consume approved friendships. |
| **Proximity / Glow** | Convert two consenting users' current device locations into a safe relationship signal. | Both users are approved Muddies, visible, unblocked, and have fresh authorised location state. | One Muddy can see a safe proximity label and meaningful glow, with no precise geography. | Expose coordinates, exact distance, map pins, routes, location history, accuracy, or street-level information. | Wave, Message, Meeting Ping, UpFor response, or Plan. | `lib/proximity/backend.ts`; safe projection schemas reject sensitive location keys. |
| **Linkr** | Help a user discover someone new who has explicitly opted into nearby social discovery. | The viewer and candidate have active Linkr sessions and pass privacy, block, relationship, and safety filters. | A discovery interaction becomes a friend request and, after mutual approval, a Muddy relationship. | Become a permanent people feed or silently turn strangers into Muddies. | Connect request, approval, then normal Muddy flow. | `lib/social/socialize-mobile.ts`; `components/socialize/socialize-page.tsx` calls the canonical friend-request action. |
| **UpFor** | Express short-lived intent or availability to do something. | A user chooses an activity, audience, broad area, duration, and optional note. | Someone responds, after which the interaction becomes communication or a canonical Plan. | Become a long-running Event, public profile state, or second calendar. | Response, Message, or Plan. | `app/(app)/hangout-actions.ts`; `hangout_sessions` and `hangout_requests`. |
| **Wave** | Send a lightweight, low-pressure hello or acknowledgement. | Existing Muddy sees another Muddy or an appropriate prompt to reconnect. | The recipient notices and may respond or start a conversation. | Pretend to be a full conversation, a Plan, or consent to friendship. In Linkr, the same label must not hide that the action actually sends a friend request. | Response, Message, Meeting Ping, or Plan. | Wave actions and Pulse notifications; Linkr currently reuses friend-request creation for its Wave interaction. |
| **Meeting Ping** | Send a directed, expiring invitation to meet to an existing Muddy. | Existing friendship, no block, and effective Buddy Plus access under current entitlement rules. | Recipient accepts, declines, or sends a reply before expiry. | Duplicate general Messages indefinitely, become a public availability feed, or be required for core communication. | Message or canonical Plan. | `createMeetupRequestAction` and response flow in `app/(app)/premium-actions.ts`; `meetup_requests`. |
| **Messages** | Provide private, contextual communication that supports relationships and coordination. | Authorised members share a direct or context-bound conversation. | Participants exchange text/media and can act on the relationship or shared context. | Become a public content universe, leak membership, or count system messages as unread human messages. | Plan, Event, Safe Arrival, relationship action, or conversation completion. | `lib/messaging/*`; conversations support direct, group, Plan, Event, and Safe Arrival contexts. |
| **Plans** | Coordinate something a relatively small set of people intend to do. | A user has an activity or commitment and selects eligible participants and timing/place details where known. | Invitees decide, participants coordinate, and the Plan reaches a meaningful completed or cancelled state. | Become public Event discovery or bypass one canonical lifecycle depending on entry point. | Plan Chat, reminder, meeting, completion, Buddy Score/Achievement update. | `lib/plans/service.ts`; `plans`, `plan_participants`, reminder and completion jobs. |
| **Plan Chat** | Keep Plan-specific coordination inside the canonical Messages system. | A Plan exists and authorised Plan participants are known. | Participants can reliably find the conversation and use timing-aware coordination actions. | Become a second messaging system or exist only for some Plan creation paths. | Meeting, Safe Arrival if useful, and Plan completion. | `createConversationForPlan` in `lib/messaging/service.ts`; context projection in `lib/messaging/mobile.ts`; timing actions in `components/messages/messages-page.tsx`. Creation is currently disconnected. |
| **Events** | Let a host create an attendance experience that can reach beyond a small private friendship group. | Host drafts, adds required presentation, and publishes an Event with start time and visibility. | People discover or receive it, RSVP, receive reminders, attend/check in, and may form later social connections. | Replace intimate Plans, act as an undifferentiated public feed, or imply precise presence without consent. | RSVP, Home agenda, reminder, attendance, optional Event Circle, post-event connection. | Event services/actions, publish flow, reminder service, RSVP/check-in state, and Home agenda projection. |
| **Circles: personal audience** | Let one user organise approved Muddies into reusable private audiences. | User has Muddies and wants scoped sharing or invitations. | The owner has a reusable list that can target supported features. | Behave like a shared group, expose membership to members, or create a conversation. | UpFor, Moment when enabled, invitation, or other audience-aware action. | `friend_circles` and `circle_members` with owner-oriented access. Recommended later name: **Lists**. |
| **Circles: community/social** | Maintain a shared social space with membership and a group conversation. | A Circle owner creates a group and people are invited, approved, or join under its policy. | Members have a shared conversation and can coordinate together. | Be confused with a private audience list or become an unmoderated public feed. | Circle Chat, shared Plan when implemented, or Event. | Group conversation, settings, member roles, discovery/join flows, and `/groups`. |
| **Circle Chat** | Provide the Messages context for a community Circle. | User is an authorised active Circle member. | Members communicate and coordinate inside one canonical conversation. | Become a separate chat product or bypass group membership authorization. | Shared Plan, Event, or ongoing community coordination. | Group conversations and `conversation_members` in the messaging architecture. |
| **Safe Arrival** | Let a traveller share a bounded journey state and confirm arrival without sharing live location. | User selects approved contacts, a destination label, expected time, and grace period. | Watchers accept, see safe status changes, and the session ends arrived, cancelled, or escalated by its neutral unconfirmed flow. | Track a route, expose exact location, require premium, or imply emergency monitoring. | Arrival/completion notification, relationship progress, then normal Home flow. | `lib/safety/safe-arrival.ts`; `lib/safety/safe-arrival-service.ts`; Safe Arrival tables and scheduled job. |
| **Journey** | Guide a user through the next available activation step using canonical completion evidence. | Authenticated user has incomplete activation steps. | The next available step completes from real data and the following available step unlocks. | Hardcode completion in the UI, require a paused feature, or become an XP game. | Next available step, My Progress, or Journey-complete state. | `lib/journey/journey.ts`; `lib/journey/journey-service.ts`; Home Smart Card and My Progress. |
| **Buddy Score** | Represent long-term trust, reliability, and constructive participation through an immutable server ledger. | Canonical social, safety, profile, achievement, or moderation events occur. | Owner sees score/progress; others see the reputation level; history remains auditable. | Reward screen time, purchases, refreshes, popularity, or client claims. | Reputation level, My Progress, and appropriate Achievements. | `lib/engagement/buddy-score.ts`; Buddy Score service/ledger; profile projections. |
| **Achievements** | Record factual, meaningful milestones as discrete accomplishments. | A canonical, eligible product event occurs. | Achievement is granted once, appears in Progress/Profile, and may contribute a defined score event. | Replace Buddy Score, use fake progress, or reward repetitive app usage. | My Progress, profile identity, or next Journey action where relevant. | Achievement catalogue/service and canonical grants across Plans, Events, safety, identity, and messaging. |
| **Notifications / Pulse** | Bring actionable relationship, coordination, safety, and account updates to the user. | A canonical application event creates an authorised notification. | User understands and acts on the update; read state and counts become accurate. | Duplicate Messages unread counts, become a content feed, or treat system timeline events as human unread messages. | Relevant request, Plan/Event, Safe Arrival, settings, or other source context. | `lib/notifications/*`; `/api/pulse`; `lib/notifications/conversation-boundary.ts`; unread-system-event migration. |
| **Invite / QR** | Bring a known person into Mad Buddy or initiate a Muddy request through a shareable invitation. | User creates/shares an invite or another person scans/opens it. | Invitee reaches the app and an explicit request can become a mutually approved Muddy relationship. | Auto-approve friendship, expose personal data, or become general stranger discovery. | Signup/login, friend request, approval, then Muddies. | Invite services and `components/invite/invite-buddies-page.tsx`; personal QR rotation and request flow. |
| **Contact Discovery** | Find opt-in Mad Buddy accounts from contacts already known by the user. | User explicitly grants supported contact access and selects contacts. | Server-side matching returns safe profile projections and the user may send a request. | Upload a permanent address book, auto-add people, or reveal non-user contacts. | Friend request and Muddy approval. | Contact discovery service hashes/matches selected contacts; `components/contacts/find-muddies-sheet.tsx`; native bridge remains incomplete. |
| **Drops** | Leave expiring, optionally locked content inside an authorised Plan, Circle, Event, or Event Circle context. | User belongs to an eligible context and creates a supported Drop with expiry/unlock rules. | Authorised recipients unlock/view it before expiry and return to the shared context. | Become a general feed, standalone file store, or leak hidden content in projections. | Underlying Plan/Circle/Event conversation or action. | `app/(app)/drops-actions.ts`; `muddy_drops`; current context picker exposes fewer context types than the backend. |
| **Moments** | When enabled in future, share temporary updates with an explicitly chosen audience. | Feature is enabled and user selects valid content and audience. | Authorised viewers see an expiring update and may use it as a lightweight connection cue. | Become the product's centre, mandatory progression, or a public engagement feed by default. | Message, Wave, or Plan. | Code retained behind `MOMENTS_FLAG`; route and Home/nav surfaces fail closed while paused. |
| **Mad Cam** | When enabled in future, provide an expressive camera/editor for supported media creation. | Feature is enabled and user intentionally opens the camera composer. | User produces a valid media asset for a supported destination. | Become a standalone camera product, block ordinary attachments, or be required for Moments. | Message/media destination or Moment when enabled. | Camera/editor code retained behind `MAD_CAM_FLAG`; ordinary attachment capture is independent. |

## 6. Feature transition graph

Status meanings:

- **CURRENTLY WORKING:** The current production path uses canonical data and has a reachable implementation.
- **PARTIAL:** The path works only under some clients, states, or entry points, or skips an expected end state.
- **BROKEN:** The intended architecture exists but the normal path does not connect to it reliably.
- **MISSING:** No reachable canonical implementation was found.
- **DUPLICATED:** More than one lifecycle authority performs materially different versions of the transition.

| Transition | Status | Current evidence and interpretation |
|---|---|---|
| Invite / QR -> friend request | **CURRENTLY WORKING** | Invite/QR surfaces create an explicit request rather than an automatic friendship. `components/invite/invite-buddies-page.tsx` communicates mutual choice. |
| Contact Discovery -> matched account -> friend request | **PARTIAL** | Server matching and safe profile results exist, and matches can lead to requests. Browser support is capability-dependent and the native contact bridge remains incomplete; production does not rely on demo contacts. |
| Linkr opt-in -> discovery candidate | **CURRENTLY WORKING** | `lib/social/socialize-mobile.ts` enforces active sessions, broad search tiers, blocks, Ghost Mode, existing-friend exclusions, and safe proximity. |
| Linkr candidate -> connection request -> Muddy | **CURRENTLY WORKING** | `components/socialize/socialize-page.tsx` sends the canonical friend request; incoming requests can be accepted. The UI term Wave is semantically misleading here because the persisted action is a request. |
| Friend request -> approved Muddy | **CURRENTLY WORKING** | `acceptFriendRequestAction` in `app/(app)/actions.ts` delegates to `acceptFriendRequest` in `lib/friends/service.ts`; the resulting approved relationship is consumed by friendship, messaging, and proximity services. |
| Muddy -> visible proximity / Glow | **PARTIAL** | `lib/proximity/backend.ts` derives safe projections correctly, but the transition legitimately depends on both users' consent, fresh device location, visibility, non-blocked state, and background/browser capability. No signal is preferable to a fabricated signal. |
| Nearby Muddy -> Wave | **CURRENTLY WORKING** | `sendWaveV2Action` in `app/(app)/social-actions.ts` creates the lightweight signal, notification, and first-Wave milestone. It does not automatically create a conversation. |
| Nearby Muddy -> direct Message | **CURRENTLY WORKING** | `openDirectConversationAction` in `app/(app)/messaging-actions.ts` delegates to `openDirectConversation` in `lib/messaging/mobile.ts`; `getOrCreateDirectConversation` and access checks live in `lib/messaging/service.ts`. |
| Wave -> response / conversation | **PARTIAL** | A Wave can prompt a response, but there is no single automatic Wave-to-conversation lifecycle. That is acceptable if Wave remains deliberately lightweight; the next action must remain clear. |
| Meeting Ping -> response | **CURRENTLY WORKING** | `createMeetupRequestAction` and its response path in `app/(app)/premium-actions.ts` enforce friendship, expiry, entitlement, and notification behavior. |
| Meeting Ping -> Plan | **MISSING** | Accepted/replied Meeting Pings do not enter canonical Plan creation. The product must decide whether a direct Plan CTA is warranted before adding it. |
| UpFor -> request / host response | **CURRENTLY WORKING** | `hangout_sessions` and `hangout_requests` support short-lived intent, requests, and accepted/maybe/declined responses. |
| UpFor -> Plan record | **CURRENTLY WORKING** | `convertHangoutToPlanAction` in `app/(app)/hangout-actions.ts` delegates to `convertHangoutToPlan` in `lib/plans/service.ts`, which calls the canonical `create_plan_lifecycle` RPC. The duplicated direct insert is gone, so validation, limits, participants, milestone and chat behavior are the same code path as standard creation. The source UpFor's UUID is the request key, so one UpFor can become exactly one Plan across retries, tabs and devices. |
| Standard Plan creation -> Plan Chat | **CURRENTLY WORKING** | `create_plan_lifecycle` creates the Plan, its participants and its Plan Chat in one database transaction. Creation can no longer half-succeed: there is no state where a Plan exists without its conversation. |
| UpFor-created Plan -> Plan Chat | **CURRENTLY WORKING** | The conversion path calls the same RPC, so it produces the same conversation as standard creation rather than a divergent pipeline. |
| Existing Plan Chat -> Messages inbox | **CURRENTLY WORKING** when the conversation exists | Messaging projections recognize `context_type === "plan"`; `lib/messaging/mobile.ts` loads Plan context and the inbox renders it. The issue is creation/reconciliation, not listing. |
| Existing Plan Chat -> timing-aware quick actions | **CURRENTLY WORKING** when the conversation exists | `lib/messaging/mobile.ts` derives Plan phase; `components/messages/messages-page.tsx` selects quick actions from the server-derived context and phase. |
| Plan participant changes -> Plan Chat membership | **CURRENTLY WORKING** | `reconcile_plan_conversation_members` is called inside the lifecycle RPCs, so adding a participant, changing an RSVP or leaving updates Plan Chat membership in the same transaction as the participant change. Membership can no longer drift from the participant list. |
| Scheduled Plan -> reminder | **CURRENTLY WORKING** | `lib/reminders/service.ts` and reminder jobs scan and deliver Plan reminders using current authorization and timing. |
| Scheduled Plan -> completed activity | **PARTIAL** | `lib/jobs/handlers.ts` advances eligible dated Plans after the active window and emits completion-related facts. Undated Plans are deliberately not auto-completed, and time passage is not proof of attendance. |
| Event draft -> cover -> publish | **CURRENTLY WORKING** | Event create/publish services support a draft flow; `lib/events/create-flow.test.ts` verifies publish requirements and scheduled state. |
| Event -> RSVP | **CURRENTLY WORKING** | `setEventRsvpAction` and canonical Event queries persist participant intent. |
| Hosted/RSVP Event -> Home "My Plans" agenda | **CURRENTLY WORKING** | `lib/social/upcoming-agenda.ts` merges hosted Events and interested/going Event RSVPs with Plans in chronological order. The transition works, but the label "My Plans" blurs the Plan/Event distinction. |
| Eligible Event -> reminder | **CURRENTLY WORKING** | `lib/reminders/service.ts` re-checks Event status, timing, block state, visibility, and RSVP at delivery. `lib/jobs/rules.ts` registers the scan/deliver jobs. |
| Event -> check-in / check-out | **CURRENTLY WORKING** | `checkInToEventAction` and `checkOutAction` persist bounded attendance state. Event Glow defaults off and requires explicit consent. |
| Event -> Event Circle | **PARTIAL** | `createEventCircleAction`, join/leave, announcement, and archive actions exist in `app/(app)/event-actions.ts`, but the primary Events UI does not call them. The capability is backend infrastructure rather than a reliably reachable product path. |
| Event attendance -> optional post-event connection | **MISSING** | No canonical Event-attendee-to-friend-request follow-up flow was found. Any future path must require explicit mutual consent and respect blocks. |
| Circle create/join -> Circle Chat | **CURRENTLY WORKING** | Community Circles use group conversations and membership roles in the canonical Messages architecture. |
| Circle -> shared Plan | **MISSING** | No explicit Circle-to-Plan lifecycle or participant policy was found. A future action must call the canonical Plan service rather than bulk-insert Plans. |
| Safe Arrival -> watcher acceptance | **CURRENTLY WORKING** | `safe_arrival_contacts.acknowledgement_status` is the canonical watcher decision and service access is limited to approved, non-blocked contacts. |
| Safe Arrival -> journey status -> arrival | **CURRENTLY WORKING** | The Safe Arrival state machine, watcher projection, realtime refresh, arrival/cancel actions, and unconfirmed job provide one privacy-safe lifecycle. |
| Canonical completion -> Buddy Score / Achievement | **PARTIAL** | Supported events such as completed eligible Plans, Safe Arrivals, profile/email milestones, and defined achievements reach progression services. Not every real-world interaction has authoritative completion evidence, so the system correctly does not invent it. |
| Journey current step -> next available feature | **BROKEN** | `lib/journey/journey.ts` includes `share_first_moment` as a mandatory ordered step. `buildJourney` does not accept feature availability, while `/moments` redirects when `MOMENTS_FLAG` is off. A user can be blocked by a paused feature. |
| Moment -> Mad Cam | **MISSING by product decision** | Both features are paused. Ordinary image/media attachment paths remain separate and must continue to work without Mad Cam. |

### Canonical transition rule

Every entry point into a domain must call the same lifecycle authority. UI labels may differ by context, but creating a Plan from UpFor, a Circle, a Ping, or the Plans page must produce the same validated Plan, participant policy, conversation, notifications, jobs, analytics, and progression facts unless an explicit domain rule documents the difference.

## 7. New-user north star

The intended activation path is:

```text
ACCOUNT
  -> IDENTITY
  -> FIRST MUDDY
  -> VISIBILITY / PROXIMITY
  -> FIRST GLOW
  -> FIRST COMMUNICATION
  -> FIRST PLAN
  -> REAL-WORLD INTERACTION
```

### Current findings

| Step | State | Finding |
|---|---|---|
| Account -> Identity | **CURRENTLY WORKING** | Signup and onboarding create the account and collect a minimal identity, while optional profile work can continue later. |
| Identity -> First Muddy | **CURRENTLY WORKING** with multiple entry points | Username search, Invite/QR, Linkr, and supported contact matching can lead to a request and mutual approval. The number of entry points is useful only if they all explain the same Muddy relationship outcome. |
| First Muddy -> Visibility | **PARTIAL** | Visibility and browser location permission exist and default conservatively. Users need a clear next action because approval alone cannot produce Glow. |
| Visibility -> First Glow | **PARTIAL** | The server derives safe proximity when both devices have fresh, authorised location and both users permit visibility. Browser background limitations and one-sided freshness can delay activation; no fabricated distance should compensate. |
| First Glow -> First Communication | **CURRENTLY WORKING** | Wave and direct Messages are available. Meeting Ping is optional and premium, so it cannot be the activation dependency. |
| First Communication -> First Plan | **PARTIAL** | Plan creation works, but communication does not consistently offer or create a canonical Plan, and UpFor conversion uses a divergent pipeline. |
| First Plan -> Real-world interaction | **PARTIAL** | Reminders, coordination surfaces, Safe Arrival, and time-based Plan completion exist, and every Plan now has a Plan Chat from the moment it is created. It stays PARTIAL for the reason that has not changed: there is no universal attendance proof, and time passing is not evidence that people met. |

### Primary activation breaks

1. **Plan Chat is not created from the canonical Plan path.** This prevents the intended communication-to-coordination continuity.
2. **UpFor conversion does not use canonical Plan creation.** A user can arrive at a different Plan depending on entry point.
3. **Journey can point at paused Moments.** The guided path can become impossible even though the actual core loop is available.
4. **Real-world completion is only partly authoritative.** Dated Plan expiry can support a completion fact, but it must not be represented as verified attendance without an explicit signal.
5. **Contact discovery is capability-dependent.** It is a useful accelerator, not a required activation step.

The future onboarding implementation should teach only the next necessary action. It should not present the entire feature catalogue or make premium, Linkr, Events, Moments, Mad Cam, Drops, or community Circles prerequisites for activation.

## 8. Returning-user north star

A returning user should answer, in order:

1. **Who is around?**
2. **What is happening?**
3. **Do I need to respond to anyone?**
4. **What am I doing next?**
5. **Secondarily, what could I do?**

### Current Home module classification

| Current module or content | Classification | Reason and future rule |
|---|---|---|
| Nearby Muddies / `NearbyHero` | **PRIMARY** | Direct answer to who is around. It is the product's distinctive relationship signal. |
| Pending invite prompt and other genuinely actionable requests | **PRIMARY** | Direct answer to whether the user needs to respond. The response source must remain canonical and deduplicated from Pulse/Messages counts. |
| My Plans / upcoming agenda | **PRIMARY** | Direct answer to what the user is doing next. It already merges canonical Plan and relevant Event agenda items, but its naming must stop presenting Events as Plans. |
| Live Safe Arrival state or invitation | **CONTEXTUAL** and urgent when present | Safety can outrank normal Home content. It should appear only when there is active or actionable state. |
| Smart Card: live Safe Arrival | **PRIMARY when present** | The engine correctly gives safety highest priority. |
| Smart Card: current Journey action | **CONTEXTUAL** | Useful during activation, but it must never route to a paused feature. |
| Smart Card: birthday, weekend plan, or nearby state | **CONTEXTUAL** | Time-sensitive, personalised cues can help answer what is happening or what to do. |
| Smart Card: membership promotion | **SECONDARY** | Commercial messaging must not outrank people, responses, or commitments. Current provider order places it below nearby state but above progression/suggestions; later Home work should validate whether it belongs on core Home at all. |
| Smart Card: Buddy progress or Achievement | **SECONDARY** | Encouragement is valuable after immediate social needs are clear. |
| Smart Card: suggestions fallback | **SECONDARY** | It answers what the user could do when nothing more relevant exists. |
| Top Events | **SECONDARY**, sometimes **CONTEXTUAL** | Discovery helps answer what could I do, but it should not displace nearby friends or commitments. |
| Suggestions for you | **SECONDARY** | Useful discovery and activation support, not a primary returning state. |
| Profile completion reminder | **CONTEXTUAL** | Show only while incomplete and never ahead of time-sensitive social/safety state. |
| More to explore / gap-filler actions | **REMOVE FROM HOME** as persistent filler | Keep destinations available in navigation or contextual entry points. Home should not become a catalogue merely because space is available. |
| Visible subscription-status content on Home | **REMOVE FROM HOME** unless action-required | Entitlement context can remain loaded, but ordinary billing status belongs in profile/billing. A failed payment or expiring trial may be contextual; a routine tier label is not. |
| Moments preview | **PAUSED** | The server-resolved flag currently hides it. It must remain absent while Moments is paused. |

### Returning-user gaps

- Home has strong answers for who is around and what is next.
- Response obligations are split among pending friend requests, Pulse, Messages unread state, Plan/Event actions, and Safe Arrival. A later orchestration task should prioritise these without merging their data models.
- `lib/smart-card/smart-card.ts` guarantees exactly one card, including a fallback. This is structurally safe, but a guaranteed card can create low-value noise when the best answer is simply the primary social state.
- Hardcoded suggestion rails and Journey can both answer "what should I do next?". They should eventually share one decision policy instead of competing.
- The Home agenda's "My Plans" label currently contains Events from `lib/social/upcoming-agenda.ts`; the data combination is useful, but the terminology is not.

## 9. Plan vs Event distinction

### Canonical Plan

A **Plan** is a relatively small, intentional social commitment, usually among existing Muddies or a bounded set of accepted participants.

Its centre is coordination:

- who is included;
- whether they are going;
- when and broadly where;
- what still needs deciding;
- a reliable Plan Chat;
- reminder and completion state.

Its successful end is that the participants meet or explicitly close the commitment.

### Canonical Event

An **Event** is a hosted attendance experience that can be discoverable or reach people beyond a small private friendship set.

Its centre is hosting and attendance:

- draft and publish lifecycle;
- presentation and discoverability;
- RSVP;
- host communication;
- reminders;
- check-in/check-out;
- optional Event Glow with explicit consent;
- optional bounded Event Circle;
- post-event connection opportunities with explicit mutual consent.

Its successful end is that people attend, leave the Event state safely, and may choose further social connection.

### Current implementation findings

- **Creation and discovery:** The implementation supports a meaningful distinction. Plans use `lib/plans/service.ts`; Events have draft, cover/publish, visibility, ranking/discovery, RSVP, and check-in flows.
- **Home language:** `lib/social/upcoming-agenda.ts` intentionally combines Plans and Events, but the current "My Plans" heading hides the distinction.
- **Edit:** No reachable canonical Event update action was found. **MISSING.**
- **Cancel:** No reachable canonical Event cancellation lifecycle was found. **MISSING.**
- **Delete:** No reachable canonical Event deletion lifecycle was found. **MISSING.** Deletion policy must preserve attendance/audit facts where required rather than blindly hard-delete.
- **Reminders:** Implemented and re-authorized at delivery in `lib/reminders/service.ts`. **CURRENTLY WORKING.**
- **Event Circle:** Actions and storage exist, but the main Events UI does not expose the lifecycle. **BACKEND INFRASTRUCTURE ONLY / PARTIAL.**
- **Post-event connection:** No explicit attendee follow-up into a friend request was found. **MISSING.**
- **Event -> agenda:** Hosted and interested/going Events enter the Home agenda. **CURRENTLY WORKING.**
- **UX distinction:** The create/publish model differs, but shared labels such as "My Plans" and plan-category notification routing can make users perceive Events as another Plan type.

Plans and Events should remain distinct. They may share calendar presentation, reminders, media primitives, and Messages infrastructure, but not one lifecycle or one user promise.

## 10. Linkr role

Linkr is an explicit, temporary discovery mode for meeting new people who are also open to discovery. It is the only people-layer feature whose primary job begins with a stranger rather than an approved Muddy.

Canonical boundaries:

- Both sides must opt into a current Linkr session.
- Discovery must remain broad and privacy-safe.
- Blocks, Ghost Mode, current relationships, passes, and safe proximity rules are authoritative.
- A discovery card is not a relationship and cannot receive normal Muddy privileges.
- The successful outcome is a friend request, followed by mutual approval, followed by the standard Muddy flow.
- Linkr must not become a permanent people feed or a popularity-ranking surface.
- Linkr availability may be optional or gated, but becoming Muddies through ordinary invite/search cannot depend on it.

Current state:

- `lib/social/socialize-mobile.ts` enforces session and discovery eligibility on the server.
- The current Linkr "Wave" action calls the canonical friend-request action. Functionally this is correct, but the label collides with the existing-Muddy Wave meaning.
- The implementation may show a deliberately coarse, display-ready approximate distance in the opted-in stranger discovery context. It must never return raw coordinates or exact distance, and the product should later decide whether the constitution standardises Linkr on the same safe labels used by Glow.

## 11. UpFor role

UpFor is the short-lived intent layer. It answers "I am open to this activity for this amount of time; who wants to join?"

Canonical boundaries:

- It expires.
- It expresses intent, not a commitment.
- It can target approved audiences and, only under explicit Linkr-style discovery rules, eligible nearby people.
- A response does not itself become a Plan.
- Accepted responses can be converted into a Plan, but conversion must call the canonical Plan lifecycle.
- It is not a long-running Event, calendar entry, permanent status, or substitute for Messages.

### Current UpFor -> Plan divergence

`convertHangoutToPlanAction` in `app/(app)/hangout-actions.ts` directly inserts a Plan. `createPlan` in `lib/plans/service.ts` is the canonical standard creation service. The differences are:

| Concern | Canonical `createPlan` | Current UpFor conversion | Effect |
|---|---|---|---|
| Rate limit | Applies `plans.create`. | Uses no Plan-create limit at conversion. | A Plan creation entry point bypasses canonical abuse/capacity policy. |
| Input validation | Uses `createPlanSchema`, title validation, and timing validation. | Trims/slices title and hardcodes several fields. | Different accepted Plan shapes and error behavior. |
| Action guard | Calls `guardAction` for Plans. | Does not call the Plan action guard. | Feature/emergency policy can diverge. |
| Subscription limits | Enforces active Plan and participant limits from effective access. | Does not check active Plan limit and hardcodes `max_participants: 10`. | Tier behavior differs by entry point. |
| Participants | Filters requested user IDs through `eligibleInvitees`; host is going and invitees start invited. | Adds every accepted UpFor requester as going, with no final canonical eligibility recheck. | Stranger discovery may be intentionally allowed, but the policy is implicit and block/eligibility changes can be missed. |
| Plan timing | Accepts validated start/end/timezone/reminder data. | Creates an undated quick Plan with `decide_in_chat`. | It will not naturally progress through time-based reminder/completion jobs until edited. |
| Plan Chat | Not currently created by standard service either. | Also not created. | Both paths break the intended coordination transition. |
| Notifications | Sends canonical "New plan invite" to invitees. | Sends custom "Your hangout became a plan" notifications. | Copy may be appropriate, but lifecycle/deduplication differs. |
| Onboarding / achievements | Records `first_plan_created`. | Does not record the milestone. | Journey/activation can remain incomplete after a real Plan is created. |
| Jobs | Dated Plans enter reminder and completion windows. | Undated converted Plan cannot use those timing paths until updated. | The Plan may remain open indefinitely. |
| Buddy Score | Completion facts can later produce defined score events. | Without timing/completion, the converted Plan is unlikely to reach those facts. | Equal real-world behavior can produce unequal progression. |
| Analytics | Database `analytics_plan_created` trigger observes Plan inserts. | Direct insert is also observed by that trigger. | Basic Plan-created analytics works, but entry-point-specific lifecycle facts remain fragmented. |

This is a **DUPLICATED lifecycle authority** and must be corrected in a dedicated implementation task. The correction should extend the canonical Plan service with an explicit UpFor conversion context rather than hiding special rules in the action.

## 12. Messaging role

Messages is one supporting system with multiple authorised contexts:

- direct Muddy conversation;
- community Circle conversation;
- Plan conversation;
- Event conversation where product policy allows it;
- Safe Arrival conversation/status context where implemented;
- media attachments bound to authorised messages.

Plan Chat and Circle Chat are contextual presentations of Messages. They are not independent messaging products.

Canonical rules:

- Conversation membership is server-authoritative.
- Context access must be re-checked when content or signed media is requested.
- Blocks and removal must stop new sends and fresh media signing.
- System events may appear in timelines or previews but are not unread human messages.
- Messages unread count belongs on Messages navigation. Pulse should not duplicate it.
- Messaging should help users move toward or coordinate real-life interaction rather than creating a separate public content universe.
- Media lifecycle, upload ownership, signing, and cleanup remain one shared architecture across conversation contexts.
- Premium may enhance media limits or convenience, but text communication between approved Muddies cannot depend on premium.

Current Plan Chat problem:

- `create_plan_lifecycle` creates the Plan, its participants and its Plan Chat in one database transaction, so a Plan cannot exist without its conversation.
- Standard creation and UpFor conversion both call it, so there is one creation path rather than two that drift.
- `reconcile_plan_conversation_members` runs inside the lifecycle RPCs, so participant changes and Plan Chat membership move together.
- Existing Plan conversations render and receive server-derived timing-aware quick actions correctly.
- Invitation notifications and the first-Plan milestone are enqueued as a durable job inside the same transaction rather than performed alongside it, so they cannot fire for a Plan that was never committed.

Therefore Plan Chat's presentation and its lifecycle connection are both implemented. What remains outside the canonical lifecycle is listed as future hardening: atomic cancellation and atomic poll-result confirmation still write directly, because no lifecycle RPC replaces them yet.

## 13. Circles role

Two different architectures currently use the word Circle.

### Personal audience Circles

Architecture:

- Owned by one user.
- Contains selected approved Muddies.
- Used as a reusable audience for privacy, sharing, invitations, or UpFor targeting.
- Members do not jointly own the structure.
- Membership is not necessarily visible to listed people.
- Does not inherently create a conversation.
- Backed by `friend_circles` and `circle_members` with owner-oriented access.

Primary job: **Help me organise who can receive something.**

Recommended later terminology:

1. **Lists** (preferred)
2. **Muddy Lists**
3. **Sharing Lists**
4. **Audience Lists**

### Community/social Circles

Architecture:

- Shared space with an owner and member roles.
- Can be private, discoverable, invited, or governed by join rules.
- Membership is part of the shared experience.
- Includes a canonical group conversation.
- Can support group coordination and, later, shared Plans.
- Backed by group conversations, group settings, conversation membership, and `/groups` UI.

Primary job: **Give us a shared place to belong and coordinate.**

Recommended later terminology:

- Keep **Circles** for the community/social architecture (preferred), or
- rename to **Communities** only if future research shows Circle is still unclear after personal Lists are renamed.

### Special audience terms

**Close Friends** is a relationship/audience designation, not another Circle architecture. It should remain a filter or attribute and should not create a third kind of Circle.

### Collision disposition

The current duplicate term is **RENAME**. Personal audience Circles should later become Lists. Community/social Circles should keep the Circle name. This is a copy and information-architecture decision; no data migration is required merely to change the product term.

## 14. Safety role

Safety is a core support layer, not a premium benefit or separate monitoring product.

### Safe Arrival

Safe Arrival lets a traveller share bounded journey status with approved contacts and confirm arrival. Its current model stores:

- traveller;
- destination label only;
- expected time;
- grace period;
- lifecycle status;
- selected contacts and their acknowledgement state;
- safe lifecycle events and blocks.

It does not need live location, route, coordinates, exact distance, or heartbeat presence.

Watcher acceptance is represented by `safe_arrival_contacts.acknowledgement_status === "watching"`. This supports safe copy such as "Shared with N" without claiming that a person is currently looking at the screen.

Canonical safety rules:

- Safe Arrival remains universally accessible.
- It must not claim emergency dispatch or live monitoring.
- Exact location is not part of its data model.
- Contacts must be approved and non-blocked, and opt-outs must be respected.
- Arrival, cancellation, and neutral unconfirmed states must be explicit and auditable.
- Safety status can outrank ordinary Home suggestions and commercial content.
- Ads and upsells are forbidden inside the active safety experience.
- Motion is decorative; status remains understandable through text and reduced-motion presentation.

Other safety foundations include block/report flows, explicit visibility controls, Event Glow opt-in, server authorization, content moderation, and safe error handling. They support every layer rather than forming separate social features.

## 15. Progression role

Progression should reflect meaningful, long-term social participation without turning Mad Buddy into a game.

### Journey

- Ordered activation guidance.
- Tells the owner what to do next.
- Completion comes only from canonical evidence.
- Only currently available steps may block progress.

### Buddy Score

- Aggregate reputation and progression.
- Built from an append-only, server-authoritative ledger.
- Rewards verified profile/relationship/safety/coordination facts and defined achievements.
- Exact score and activity are owner-only; other users see only the public level.
- Does not reward premium purchase, screen time, scrolling, refreshing, or popularity.

### Achievements

- Discrete factual milestones.
- May contribute defined Buddy Score events, but do not replace the score or level.
- Should remain sparse, meaningful, and non-competitive.

### Recaps

- Retrospective summaries of canonical facts.
- Do not create new truth or reputation.
- Must respect the same privacy and authorisation rules as their source data.

### Identity

- Profile, effective membership, reputation level, achievements summary, safe birthday-derived details, and meaningful activity projections help approved Muddies recognise a person.
- Effective membership badges communicate access tier, not trust, identity verification, or the source of access.

### Current progression conflict

`share_first_moment` is a mandatory Journey step in `lib/journey/journey.ts`, and `lib/journey/journey-service.ts` derives it from Moment count. Moments is paused and `/moments` redirects when disabled. In addition, `lib/trust/trusted-member.ts` sets required Journey completion to `JOURNEY_STEP_IDS.length`, so the paused step can also block Trusted Member eligibility.

Required later remediation:

1. Resolve feature availability on the server before building Journey.
2. Exclude unavailable steps from the active ordered count and current-step selection, or mark them explicitly non-blocking.
3. Preserve prior completion evidence and history; do not erase or fake it.
4. Ensure Home, My Progress, and Trusted Member eligibility consume the same availability-aware Journey projection.
5. Test feature on/off transitions so enabling Moments later adds a legitimate optional/current step without corrupting completed progress.

Journey suggestions and Home suggestions should be **MERGED CONCEPTUALLY** under one next-action policy. They may have different UI surfaces, but they must not offer contradictory priorities.

## 16. Paused features

### Moments

State: **PAUSED**.

Current controls:

- `MOMENTS_FLAG` is distinct from Open Moments and fails closed when unavailable.
- The Moments route redirects to `/dashboard` when the feature is disabled.
- App navigation and Home preview are hidden from server-resolved feature state.
- Code, storage, notifications, and historical data remain in the repository.

Residue requiring later work:

- Mandatory Journey step `share_first_moment` still assumes Moments is available.
- Trusted Member eligibility inherits the same impossible total through `JOURNEY_STEP_IDS.length`.
- Historical notification or deep links can still reach a route that redirects. This is safe but should eventually show a deliberate unavailable state when useful.
- Any future CTA inventory must be tested against the server-resolved flag, not only hidden by client UI.

### Mad Cam

State: **PAUSED**.

Current controls:

- `MAD_CAM_FLAG` is a dedicated fail-closed flag.
- The specialised composer is gated in the app shell.
- Ordinary message image capture and media attachments are architecturally independent and remain available.

Residue rule:

- No Journey, onboarding, Plan, Message, Moment, or media upload flow may require Mad Cam.
- A paused Mad Cam must not disable the normal file picker, camera input used by attachments, or media rendering.

### Paused-feature invariant

Feature flags must affect the server-derived product graph, not only presentation. A paused feature must be absent from required Journey counts, next-action selection, entitlement prerequisites, Home CTAs, navigation, and notification generation.

## 17. Terminology conflicts

### Trust and identity map

| Current term | Current meaning | Who sees it | How it is earned or granted | Confusion risk | Recommended later direction |
|---|---|---|---|---|---|
| **Trusted Buddy** | Buddy Score reputation level beginning at the configured threshold. | Owner sees exact score/progress; others may see level. | Canonical score ledger events from healthy participation and confirmed outcomes. | High: sounds like identity verification or staff endorsement. | Consider **Trusted** as a reputation level with explicit "Buddy Score level" context. Do not use "verified" copy. |
| **Trusted Member** | Staff-recognised long-standing member status, separate from identity verification. | Public badge/profile surfaces where projected. | Current eligibility includes continuous premium history and all Journey steps, followed by review; staff can grant through audited admin paths. | Very high: sounds nearly identical to Trusted Buddy and can imply identity verification. Current premium/Journey prerequisites also blur trust with payment and paused features. | Prefer **Recognised Member** or **Community Standing** after policy review. Remove paused-feature dependency in a later implementation task. |
| **Verified Account** | Staff-confirmed account/identity state from `account_verifications.status === "verified"`. | Public surfaces using `VerifiedAccountMark`. | Granted/revoked by authorised staff under audited admin workflow. | Medium: users may not know what was verified unless policy/copy is precise. | Keep **Verified Account**; never shorten to generic "Verified" without accessible explanation. |
| **Verification** in discovery trust | Older layered evidence such as confirmed email, phone, institution, or official organisation. | Discovery/trust projections where used. | Derived from current verification evidence. | High: overlaps Verified Account; phone verification may not be fully reachable. | Rename evidence-specific labels, for example **Email confirmed** or **Organisation confirmed**, and avoid one generic verification ladder. |
| **Buddy Score** | Long-term server-derived reputation score and level. | Exact details to owner; level only to others. | Immutable score events, not purchases or screen time. | Medium when a level is named Trusted Buddy. | Keep **Buddy Score** as the system name and always identify public text as a reputation level. |
| **Buddy Plus / Buddy Pro badge** | Effective membership tier, independent of paid/trial/earned/admin-granted source. | Identity surfaces selected for recognition. No badge for Free. | Server-authoritative effective entitlement projection. | Medium if premium gold styling looks like verification. | Keep tier names and ensure accessibility text says membership, not trust or verification. |

### Other terminology collisions

| Collision | Disposition | Decision |
|---|---|---|
| Plans vs Events | **KEEP DISTINCT** | Private/small commitment versus hosted/discoverable attendance experience. Shared agenda and reminders do not make them the same lifecycle. |
| Plans vs UpFor | **KEEP DISTINCT** | Intent expires; a Plan is a commitment. Conversion must use canonical Plan creation. |
| UpFor vs Meeting Ping | **KEEP DISTINCT** for now | UpFor is one-to-many or audience availability; Meeting Ping is directed and expiring. Future research should test whether Ping adds value beyond Message quick actions before expanding it. |
| Linkr vs nearby Muddies | **KEEP DISTINCT** | Linkr discovers opted-in strangers; Nearby Muddies displays approved relationships. |
| Personal Circles vs community Circles | **RENAME** | Rename personal audiences to Lists; keep Circles for shared communities. |
| Messages vs Circle Chat | **MERGE CONCEPTUALLY** | Circle Chat is a Messages context with Circle authorization. |
| Plan Chat vs general Messages | **MERGE CONCEPTUALLY** | Plan Chat is a Messages context with Plan authorization and timing. |
| Events vs Event Circles | **BACKEND INFRASTRUCTURE ONLY** until reachable | Event Circle actions exist but are not a reliable primary-UI path. It is an optional subspace, not another Event. |
| Journey vs Home suggestions | **MERGE CONCEPTUALLY** | One server policy should choose the next meaningful action. Multiple surfaces may render it. |
| Buddy Score vs Achievements | **KEEP DISTINCT** | Score is aggregate reputation; achievements are factual milestones. Achievements can emit score events without becoming the score. |
| Trusted Buddy vs Trusted Member vs Verified Account | **RENAME** | Keep Verified Account; clarify the reputation level; rename staff-recognised standing after policy review. |
| Moments vs normal coordination | **HIDE FOR NOW** | Moments is paused and must not compete with communication/coordination. Retained code is not a reason to surface it. |
| Mad Cam vs ordinary message media | **KEEP DISTINCT** and **HIDE FOR NOW** for Mad Cam | Mad Cam is an optional editor; ordinary attachments are core communication capability and must work independently. |
| Wave in Muddies vs Wave in Linkr | **RENAME** in Linkr later | Existing-Muddy Wave is a signal; Linkr currently sends a friend request. Use connection language for the latter. |

## 18. Product invariants

These rules are binding for future product and implementation work.

### Privacy and safety

1. Exact friend location is never exposed.
2. The UI and user-facing APIs must never return latitude, longitude, coordinates, exact distance, meters, accuracy, geohash, routes, street-level position, or location history.
3. Raw device location may be accepted only for the current user's own server-side proximity calculation and protected storage. It must never appear in another user's projection, logs, analytics, notifications, or exports.
4. A missing, stale, blocked, paused, or unauthorised signal must not be replaced with fabricated proximity.
5. Safe Arrival remains universally accessible and does not require premium.
6. Safe Arrival does not claim live monitoring, emergency response, or route tracking.
7. Event presence and Event Glow require explicit consent; check-in must not silently broadcast presence.
8. Ads, upsells, and promotional interruptions must never invade private messaging or active safety experiences.

### Relationships and discovery

9. Muddies are mutually approved relationships.
10. Linkr discovers new, explicitly opted-in people; Muddies manages existing approved relationships.
11. Contact Discovery and Invite/QR may initiate a request but never auto-approve a relationship.
12. Blocks and relationship removal must apply consistently across discovery, proximity, messaging, media signing, Plans, Events, and safety.
13. A stranger-discovery projection cannot silently gain Muddy privileges.

### Intent, coordination, and messaging

14. UpFor expresses temporary intent. It is not a Plan or Event until a canonical transition creates one.
15. Plans coordinate small or private social commitments.
16. Events are hosted or discoverable attendance experiences.
17. Plans and Events may share primitives, but each has one distinct lifecycle authority.
18. Plan Chat, Circle Chat, and other context chats use one canonical Messages architecture.
19. Core communication between approved Muddies must not depend on premium.
20. System messages are not user unread messages.
21. Messages unread state belongs to Messages; Pulse must not duplicate it.
22. One backend authority governs each lifecycle. Alternative entry points must call it rather than recreate partial behavior.
23. User-visible success is shown only after the canonical server mutation succeeds.

### Progression and entitlements

24. Disabled or paused features cannot block Journey, eligibility, onboarding, or core-loop progression.
25. Buddy Score reflects confirmed healthy participation, not payment, screen time, refreshing, scrolling, or popularity.
26. Negative reputation adjustments require confirmed moderation outcomes and an auditable event.
27. Exact Buddy Score and activity history are owner-only; public profiles receive only the authorised level.
28. Achievements record facts and must not duplicate Buddy Score or Journey state.
29. Membership badges represent effective tier, not trust, identity verification, or access source.
30. Paid, trial, earned, and admin-granted access resolve through the server-authoritative entitlement system.
31. Core friendship formation and the network's basic usefulness must not depend on premium.
32. Premium enhances capacity, control, expression, or convenience rather than making the network functional.

### Product composition

33. Home orchestrates current social state. It must not become a permanent feature catalogue.
34. New features must state how they connect to the core social loop.
35. Context-specific UI may vary, but canonical relationship, Plan, Event, Message, safety, score, and entitlement truth cannot be duplicated.
36. Paused Mad Cam cannot disable ordinary media attachments.
37. Public or temporary content cannot become mandatory to use private coordination.
38. Empty states represent genuine absence of data, not invented activity.
39. Analytics observe canonical events and never create product truth.
40. User-facing trust language must distinguish reputation, staff-recognised standing, identity verification, and membership.

## 19. Explicit non-goals

Mad Buddy is not trying to maximise:

- daily screen time;
- endless scrolling;
- public follower counts;
- viral public content at the expense of private relationships;
- competitive social scoring;
- streak anxiety;
- exact location sharing;
- passive background surveillance;
- a universal public map;
- a generic camera/editor product;
- a general-purpose messenger disconnected from real-world social coordination;
- a full calendar replacement;
- a public Events marketplace as the primary product;
- a second social graph for each feature;
- premium conversion by withholding core friendship or communication;
- feature count.

Moments, Mad Cam, Drops, Events, and community Circles can be valuable only when they support the core loop and preserve the privacy promise. Their existence in the repository does not give them equal Home priority.

## 20. Known architecture conflicts requiring later work

The following are future implementation tasks. This constitution does not implement them.

### Priority 0: Core-loop correctness

1. **Make Plan creation one canonical transaction/service.** Extend `lib/plans/service.ts` so standard creation and contextual creation can apply explicit policies without direct inserts elsewhere.
2. **Create and reconcile Plan Chat.** Call the canonical Plan conversation factory after successful Plan creation, make it idempotent, and reconcile membership when Plan participants change.
3. **Route UpFor conversion through canonical Plan creation.** Preserve the source context and appropriate accepted-participant semantics while enforcing rate limits, guards, tier limits, validation, notifications, jobs, analytics, Journey, and score behavior.
4. **Make Journey availability-aware.** Remove paused features from blocking order/count without deleting completion evidence. Use the same projection in Home, My Progress, and Trusted Member eligibility.

### Priority 1: Lifecycle completeness

5. **Complete Event lifecycle:** add canonical edit, cancel, and deletion/archive policies with authorization, notifications, reminder cancellation, media handling, and audit behavior.
6. **Decide and expose Event Circle deliberately:** either connect the existing backend to the Event experience or keep it infrastructure-only and stop implying availability.
7. **Design opt-in post-event connection:** allow an attendee to send a normal friend request without exposing the attendee list beyond policy or auto-creating relationships.
8. **Add Circle-to-Plan through canonical Plan creation:** define who can invite whom, how audience membership maps to Plan participants, and how blocks/removals are rechecked.
9. **Define real-world completion evidence:** distinguish a scheduled item ending from confirmed attendance so progression never overclaims participation.

### Priority 2: Product clarity

10. **Rename personal audience Circles to Lists.** Keep community Circles as the shared social architecture.
11. **Clarify trust terms:** distinguish Buddy Score reputation level, recognised community standing, Verified Account, evidence confirmations, and membership badges.
12. **Rename Linkr's friend-request action:** do not call it Wave if it creates a connection request.
13. **Clarify Home agenda naming:** use language broad enough for Plans and Events while preserving their distinct identities.
14. **Unify Home and Journey next-action policy:** prevent hardcoded suggestion rails and Journey from competing, while keeping Home focused on people, responses, and commitments.
15. **Review Meeting Ping's future:** keep it distinct while validating whether its directed premium prompt adds value beyond Message quick actions and Plan creation.

### Priority 3: Optional capability completion

16. **Complete Contact Discovery capability parity:** retain explicit consent and hashed matching; add the native bridge only through the current privacy model.
17. **Align Drops UI with backend-supported contexts:** either expose Event/Event Circle contexts safely or narrow the documented backend contract. Keep Drops optional.
18. **Handle paused-feature deep links deliberately:** historical notifications should fail safely with clear availability state, while no new paused-feature notifications are produced.
19. **Keep Moments and Mad Cam paused until separately approved:** do not enable them as a side effect of Journey, Home, messaging, or media work.

### Required review gate for future work

Before implementing any item above, the task must identify:

- the canonical service that owns the lifecycle;
- the server-authoritative access decision;
- the privacy projection;
- the transition into and out of the feature;
- notification and unread ownership;
- analytics/progression consequences;
- unavailable/disabled behavior;
- tests proving that alternate entry points cannot diverge.

This document is the product-level source of truth. Where current code conflicts with it, the conflict remains documented until a separately approved implementation task changes the code and updates this constitution.
