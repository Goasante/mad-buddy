# Optional feature launch controls

Launch scope keeps Glow/nearby Muddies, Messages (including group conversations), Muddies, profiles, Plans, privacy/safety controls and account settings available. UpFor, Linkr, Events, Conference and new Safe Arrival journeys are locked by the release migration and can be individually enabled from Admin → Features.

| Feature | Flag | Entry points | Recommendations and background work |
| --- | --- | --- | --- |
| UpFor | `upfor` | `/hangout-mode`, Home/profile links, mobile open-to-plans API | All UpFor card families and evergreen fallback excluded; scheduled announcements paused; expiry and cancellation retained |
| Linkr | `socialize` | `/linkr`, `/discover`, native `/socialize` | Discovery/profile activation guard; mutual-match and setup cards excluded; existing messaging retained |
| Events | `events` | `/events`, ranked Events, event detail sheets, chat/profile/Create links, native Events | Ranked Home module and event agenda suppressed; Plan agenda retained; Event cards and notifications suppressed |
| Conference | `conference` | Quick Actions, topic deep links, Settings notification preferences | Existing server enforcement retained; notification preferences disabled without overwriting saved values; reply delivery suppressed |
| Safe Arrival | `safe_arrival` | Settings, Quick Actions, Home/profile, native `/safety` | New journeys blocked; active traveller/watcher controls, lifecycle alerts and SmartCard safety obligations continue |

## Presentation and refresh

Locked entry points remain visible with a padlock. Opening one renders a strongly blurred sample layout, feature name, product copy and Back to Home. Samples contain no real private content, media URLs, feature fetches or active controls. Server route checks happen before feature readers run. A client route boundary unmounts already-open locked surfaces when availability refreshes. Availability refreshes every 30 seconds and on focus, and changed flags refresh the server projection. Mutations recheck server availability immediately; relevant database insert guards also prevent a concurrent request from creating new records after locking.

Shared web/native links add padlocks, including Settings and Create menus. Feature guides inherit availability from their route/CTA; manual walkthrough entries lead to the preview rather than starting a locked guide. Shared settings stay usable, particularly Plans notifications, proximity alerts and quiet hours. Privacy controls, blocking, cancellation, expiry and account deletion are retained.

## SmartCard invariants

Availability filters provider output before the existing selection engine. Priority, acknowledgements, impression cooldowns, expiry, maturity/ownership gates and stored progress are preserved. Primary and secondary destinations are checked independently, including Event Linkr's two domain dependencies. A locked Journey destination cannot be recommended. UpFor's existing fallback returns when enabled; a core Muddies fallback covers its locked state. The approved catalog now contains 58 states, with 32 Card B classifications. New eligibility is not permission to revive expired facts or reset historical acknowledgements.

## Data and rollout

The migration adds three controls and switches all five optional launch flags off. It retains data and ownership policies, adds restrictive authenticated access policies, and blocks new server-RPC inserts for Events, UpFor and Safe Arrival. No core tables are gated. Existing Safe Arrival journeys finish through the existing authority. Promotional notifications check flags before persistence and queued push delivery rechecks on dispatch. Cleanup keeps running.

Deploy this change and its migration together during a controlled release. The branch does not itself change the live app. Re-enable each feature from Admin → Features, using its existing audited confirmation flow; no redeploy or record reset is needed. Roll back availability by re-enabling the flags, keeping the protection code in place. Reverting code alone while leaving the database guards installed is not a complete rollback.

## Validation

- Full root unit suite: 9,416 passing tests across 578 suites; native unit suite: 26 passing tests.
- Web and native production builds pass, including TypeScript checks. Lint has zero errors (123 warnings).
- Isolated PostgreSQL migration exercise verifies server/client insert denial, restrictive reads, retained records, unlocking, active Safe Arrival completion and ongoing expiry. Staging schema was read to check table compatibility; no live/staging flags or data were changed.
- Final review corrected stale availability responses, locked QR action copy, a missing guide padlock and an already-open Safe Arrival setup sheet. Targeted review suite: 2,227 passing tests; root/native TypeScript checks and changed-file lint pass.
- Migration applied to synthetic staging and verified: five flags off, 42 restrictive policies, four insert triggers, server insert guards deny locked activity, zero added release policies on core tables. Staging migration head: `20261004202823`. Production remains at 174 migrations with head `20261003214905` until release.
- Vercel preview build is READY; exact-head GitHub CI passes. Browser review is blocked by Vercel authentication; sign-in is required before live release.
