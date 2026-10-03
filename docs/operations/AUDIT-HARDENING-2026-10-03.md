# Audit hardening: 3 October 2026

## Release boundaries

This batch is a focused repair, not a redesign or a claim that every audit item
is closed. Production has not been changed during preparation. Database changes
were applied and checked on staging only. Never auto-resume the four stalled
production deletion requests: the user must explicitly retry, or an operator
must obtain separate approval for the exact account.

## Confirmed deletion blocker

Deleting an Auth user invokes `domain_events.actor_id ON DELETE SET NULL`.
`prevent_domain_event_mutation()` previously rejected every update, including
that FK anonymization. A staging synthetic Auth deletion reproduced the failure.
All four pending production deletions have actor references in this table.

The repair allows only nested-trigger actor anonymization after the Auth row
disappears, with every other event field unchanged. Arbitrary actor removal,
payload edits and event deletion remain rejected. Shared threads and other
accounts remain present after synthetic account deletion.

## Other focused changes

- Prevent a missing profile from being recreated during unfinished deletion.
  Database insert guards also cover privileged profile/media-asset bootstrap.
- Tombstone the deleting author's messages and detach their media before Auth
  removal; keep shared message identities and other users' messages.
- Fail closed rather than skip Conference cleanup after a failed readiness read.
- Preserve deletion requests after failure; report native partial completion at
  both data-purged and audited stages; allow 60 seconds for the native endpoint.
- Surface queue enqueue, claim, completion and retry acknowledgement errors.
  A completion-ack failure leaves the lease for stale recovery; it does not
  immediately retry an already successful external side effect.
- Make block writes settle relationship/request state in the database
  transaction. Acceptance takes the same pair lock before row locks and refuses
  an existing block. Existing RPC signature and reactivation semantics remain.
- Scope the poll-parent helper to current joined conversation membership.
- Atomically reserve ordinary push budgets; preserve critical/high bypass.
- Bound web-push transport calls to ten seconds. This is not durable retry.
- Skip Conference background refreshes while hidden; refresh on visibility
  return, with existing visible-page timing unchanged.
- Log failing readiness check names privately without exposing values publicly;
  remove an unnecessary exact profile count from the database probe.

## Verification

`scripts/security/audit-hardening-rollback.sql` runs only on staging. It creates
synthetic identities, checks member/outsider access, ordinary acceptance,
block precedence, isolated budget reservation, browser RPC restrictions,
deletion bootstrap/upload rejection, append-only protection, authored media
tombstoning and Auth cascade. It rolls back every fixture change. This is a
database integration test, not a complete browser-to-Auth-API deletion journey.

Unit tests cover storage pagination, scoped cleanup, partial failures, retries,
audit deduplication, bootstrap failures and queue acknowledgement behavior.
The full unit suite, lint, types and production build must pass before merge.

## Deployment order

1. Review both generated migrations against production definitions and ensure
   no new caller grants or bulk deletions are introduced.
2. Apply the additive database migrations before deploying the application,
   because normal notification delivery depends on `reserve_notification_budget`.
3. Deploy reviewed code via the established main-branch workflow, not previews.
4. Verify homepage, health and readiness, then a newly created disposable account
   through real deletion. Do not test by deleting a customer's existing account.
5. Monitor queue persistence errors and notification outcomes. No blanket
   replay of historical dead letters or stalled deletions.

## Audit items still open

- Exact production-readiness failing subcheck and provider configuration.
- Durable push outbox/retries and real iOS/Android delivery tests.
- Independent heartbeat/uptime alerts, backed-up database and Storage restore
  evidence, provider patch availability and commercial hosting eligibility.
- Load envelope, Ghana-device performance and targeted query-plan/index work.
- Consent configuration and owner recovery/admin access evidence.

Do not weaken readiness to return 200, add every suggested index, buy/upgrade a
plan, export production personal data, rotate credentials, or change provider
billing as part of this batch without the necessary access and decisions.
