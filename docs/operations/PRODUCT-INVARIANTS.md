# Mad Buddy Product and Security Invariants

These are not styling preferences. They are product/security boundaries that a developer must preserve unless the owner explicitly changes the product constitution.

## Privacy and proximity

- Never expose exact GPS coordinates to another user.
- Never show exact measured distance, street-level location, live map pins, or location history.
- Proximity is represented with coarse qualitative bands such as `Right Here`, `Just Around`, `Close By`, `In Your Area`, `Around Town`, and `Across Town`.
- Approved Glow-led teaching surfaces may pair those terms with their canonical category ranges (`0–100 m`, `100–500 m`, `500 m–2 km`, `2–5 km`, `5–10 km`, `10–15 km`). These ranges explain the vocabulary; they are derived from the same band thresholds and are not the person’s measured distance.
- The 15 km nearby eligibility ceiling remains authoritative. Never imply an in-range state such as `15 km+` that would include people the backend excludes.
- Stale proximity is not current proximity. Cached/stale state must not be presented as live truth.
- The database intentionally stores only the latest user location rather than a movement history.

## Safe Arrival

- Safe Arrival is a safety feature, not a tracker.
- No exact route/map/location history should be exposed through the experience.
- Stale, failed, waiting, overdue, or unresolved states must be represented truthfully.
- Safe Arrival must not be monetized or hidden behind Mad Buddy Access.
- Safety/truth states outrank ordinary engagement opportunities on Home.

## Linkr

- One-sided Linkr decisions are private.
- A relationship/mutual may only be surfaced when mutuality is canonically established.
- Event attendance is not Event Linkr consent.
- Event check-in is not Event Linkr consent.
- Event Linkr discovery must respect the existing attendance/check-in/consent eligibility chain.
- The main Linkr discovery experience may use swipe left = Pass and swipe right = Connect; do not replace this casually with a generic directory/list.
- A Home/Smart Card Linkr opportunity must have a truthful grounded reason and must not leak private ranking data or one-sided interest.

## UpFor

- Users can own multiple UpFor sessions simultaneously.
- Creation is additive; never reintroduce the old single-global-active-session assumption.
- Existing UpFor commitments/relationships must survive Access expiry where product rules say continuity is free.
- Muddy-side UpFor remains part of the existing social world; stranger expansion is the monetized boundary.
- UpFor → Plan must continue through the canonical Plan lifecycle rather than inventing a second Plan creation path.

## Plans

- Plans are the canonical commitment/coordination layer.
- Plan creation → Plan Chat and participant reconciliation use canonical server/database authority; do not rebuild duplicate lifecycle logic client-side.
- RSVP/poll actions must reuse existing canonical actions/RPCs.
- UI copy must match what an action actually does. If a button only opens a Plan, use wording such as `Respond` / `Review Plan` rather than claiming a mutation occurred.

## Messaging

- Existing conversations/messages are continuity and remain available independent of expansion Access rules.
- Conversation membership/authorization is server-side authority.
- Do not surface unauthorized message text on Home/notifications.
- Preserve existing optimistic/draft/retry/idempotency/realtime behavior unless a proven defect requires change.

## Mad Buddy Access

Current product principle:

> **The user's existing social world is free. Expanding the social world is paid.**

- Current consumer product is **Mad Buddy Access**, not the retired Buddy Plus/Buddy Pro feature ladder.
- Linkr discovery and the paid expansion side of UpFor are Access-controlled.
- Existing relationships, existing commitments, Messages, Muddies, Plans, and safety continuity must not be broken when Access expires.
- Entitlement checks must use the canonical Access resolver; do not invent another `isPremium` flag.
- Price/plan selection is server-owned. Clients never choose the amount charged.

## Home ownership

Home has separate responsibilities:

- **Card A — Activation / Relationship:** `FirstMuddyCard` / `ActivationCard`.
- **Card B — Smart Opportunity:** cross-product opportunity/obligation/status.
- **NearbyHero:** dedicated proximity payoff.

Do not collapse these into one giant generic card system or duplicate the same instruction across surfaces.

Only one adaptive card should be visually loud at a time. Safety can retain full visual authority even when Activation is present.

## Moments

Moments is paused/discontinued for the current phase.

- Do not restore Moments as a Smart Card source.
- Do not restore Moments as a Journey requirement.
- Do not add Moments progression dependency or Home creation prompts without an explicit product decision.

Historical Moments tables/code may still exist; historical presence is not current product authority.

## Server/client security boundary

- Browser/native clients are inspectable and untrusted.
- `SUPABASE_SERVICE_ROLE_KEY`, database passwords, Firebase service-account private keys, VAPID private keys, Paystack secret keys, cron secrets, signing secrets, and similar privileged credentials must never be shipped to clients.
- Authorization lives in RLS, server actions/routes, RPCs, and explicit server-side checks.
- A hidden button or hidden JavaScript branch is not authorization.

## Database/migration authority

- Migration history is canonical schema history.
- Never hand-fix Production and then declare the repository reproducible.
- Destructive remote commands require explicit project-ref verification immediately before execution.
- Production must never be used for fixtures, seed data, load testing, or negative probes involving real-user mutation.

## Release authority

- Do not call a release successful only because a Vercel deployment exists or a SHA appears in metadata.
- Verify exact commit lineage, migration state, CI, and served runtime.
- Preserve an explicit rollback path.

## Native architecture

- One product/codebase direction: web authority plus Capacitor native clients/shell capabilities.
- Native package/bundle id is `com.madbuddy.app`.
- The bundled native SPA does not get privileged server secrets.
- Native-specific work includes safe areas, keyboard, lifecycle, Android back, iOS gestures, push, permissions, OAuth/deep links, camera/mic/photo access, signing and store packaging.
