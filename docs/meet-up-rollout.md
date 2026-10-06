# UpFor scheduling and Meet Up rollout

## Product boundaries

- UpFor retains Nearby / Muddies audiences and the existing conversion to Plan Chat. Now and future dates are discoverable, including Popular. Interest alone is not a Plan.
- Future UpFors converted to Plans appear in the existing Home Plans / Events carousel. Now conversions keep their Plan Chat and Plans-page entry, without becoming upcoming Home cards. Events are unchanged.
- `/plans` remains the user's existing Plans page, including its current invitation, chat, and planning features.
- `/meet-up` is a separate invitation-based feature: Come over, I'm coming to you, or Meet somewhere. Home has a small separate Meet Up section; it does not replace the Plans carousel.
- Each person accepts, updates their own arrival, and confirms meeting for themselves. Rescheduling increments the revision and asks non-withdrawn participants again. Lack of confirmation is not proof of failure.
- Optional proximity requires both participants' explicit opt-in, an accepted arrangement, current readings, and both Glow audiences. Ghost Mode, blocks, and Privacy Zones override it. Only a coarse Nearby hint is returned; it cannot prove arrival at a venue. No background PWA arrival guarantee is made. Rescheduling and responding reset proximity consent.
- New Safe Arrival creation is retired in web and native transports. Existing lifecycle actions, Home journey cards, and old notification links are retained.

## Deployment order

These changes have not been applied to a live database. Apply the two migrations before deploying their application code:

1. `20261006160837_upfor_future_discovery.sql`
2. `20261006161651_meet_up_core.sql`

Meet Up uses the existing `safe_arrival` release flag. This change does not enable it. Keep the existing release state until staged testing is complete. The server job scheduler adds `meetups.notifications` every five minutes; immediate delivery is also attempted after a successful mutation. Failed delivery remains in the durable outbox for retry, with bounded attempts. Notification settings, quiet hours, and delivery budgets still apply.

The native app has a `/meet-up` screen using the shared Meet Up UI, with its own API transport and refresh. The native transport is `GET /api/meetups`, `POST /api/meetups` for creation, and `PATCH /api/meetups` for updates. Both web and native mutations use the same authenticated command service. Browser requests retain the existing CSRF checks; native bearer requests use fresh Auth verification. SQL tables and RPCs are inaccessible directly to anon/authenticated roles.

The notification worker skips database reads while the release flag is off. Before each delivery, it checks current invitation, participant, revision, arrival, and reminder timing state, discarding superseded messages. Nearby hints expire in the UI and are cleared on failed location refresh. Forms explicitly use POST to keep meetup details out of fallback GET URLs.

## Verification

Run `npm run typecheck` and the affected Vitest suites (`lib/meetups`, `lib/social`, `lib/time`, `lib/plans`, `lib/navigation`, `lib/features`, `lib/jobs`, `lib/notifications`, `lib/safety`, `lib/proximity`, `lib/security`, `lib/platform`). Build both web and native apps and run `scripts/verify-mobile-imports.mjs` and `scripts/verify-mobile-bundle.mjs` from the repository root.

`scripts/hardening/meetup-db-proof.mjs` runs the migration in an isolated in-memory PostgreSQL instance, never a remote database. Supply `MEETUP_PGLITE_MODULE` pointing to a separately installed `@electric-sql/pglite` module. It covers permissions, idempotency, revisions, host acceptance, per-user confirmation, reminders, consent resets, and outbox leases.

Before release, test with two real accounts in staging: all three modes, acceptance and withdrawal, time suggestions, reschedule/reacceptance, reminders with the app closed, notification deep links, Ghost Mode, Privacy Zones, stale/denied location permissions, and legacy journey completion. These browser/device and live-delivery checks have not yet been performed. Do not describe automated tests as proof that OS push delivery or automatic arrival works.

For rollback, keep the new tables and existing journey data intact. Roll back application behavior in a controlled release; do not drop Meet Up data or abandon already-created arrangements.
