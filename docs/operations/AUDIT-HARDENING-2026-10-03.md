# Audit hardening: 3 October 2026

## Release boundaries

### Durable push follow-up (PR #126)

PR #126 merged as `6d33b84aa035811868e2e22f5c29cc2445855462` after all
candidate CI jobs passed (`37157003404`). Production version verification at
22:06 UTC confirms that exact commit from deployment
`dpl_58SCDusTumZJLT92qPJg33Evfize`; Vercel reports success.
Homepage, login and shallow health return 200; unauthenticated account deletion
returns 401. Deeper readiness still returns its pre-existing 503. Private Vercel
log tools are not exposed in this session despite the successful connection;
the failing check has not been identified. No push rows existed at the initial
post-deployment checkpoint, so this is not live transport delivery proof.

Notifications now have a private database outbox with independent web/native
device deliveries. In-app persistence, semantic deduplication and ordinary push
budget reservation happen in one transaction. Immediate delivery runs after the
response; the existing cron tick recovers queued or stale deliveries. Preference,
block and account-deletion checks are repeated before transport. Deleting an
account purges its dispatches and delivery children.

Retries are bounded to five attempts and a one-hour delivery lifetime, with
exponential backoff and fenced leases. Acknowledgement failures retain the lease
instead of immediately repeating a successful provider call. Stable notification
tags help collapse duplicates, but delivery is at least once, not exactly once.
Web requests have a ten-second timeout. Native SDK calls can outlast the local
25-second claim budget; the worker stops claiming new batches, and stale leases
recover after five minutes. Expired dispatches are removed in bounded batches
after roughly seven days. Payloads exclude device addresses and tokens.

Migrations `20261003213820_durable_push_delivery.sql` and
`20261003214905_push_claim_maintenance_alias.sql` are applied to staging and
Production before application deployment. Production history has 174 entries,
head `20261003214905`; canonical versions, grants and RLS were verified. The second
qualifies the maintenance query's ID to avoid a PL/pgSQL output-name ambiguity.
Browser roles have no table or RPC access; service-role RPCs use invoker security.

Verification: 576 test files passed, 9,400 tests passed and one skipped; type
checking and production build passed. Full lint had zero errors and 118 existing
warnings. Synthetic staging checks covered atomic persistence, budget limits,
deduplication, partial device recovery, lease fencing, retry exhaustion, expiry,
global maintenance, deletion cascades and browser denial. Every fixture rolled
back, with no synthetic Auth users remaining. No real device push was sent.
Readiness diagnosis and the other operational audit gaps remain open.

### Production status at 21:35 UTC

PR #125 is merged as `2cb0ecd6bd3f77d1b10c1940688ca9ca18fa8028`.
`mad-buddy.com/api/version` serves that exact main commit from deployment
`dpl_3L6ioT5Ly78Bh28svqvA3E53Knwv`. Candidate and post-merge quality,
production-build and mobile CI jobs passed. Both migrations below are applied
to Production with their repository versions; migration history has 172 entries
and head `20261003210234`. Grants, guards and function definitions were checked
without mutating customer accounts. The four stalled requests were not replayed.

Homepage, login and shallow health respond 200. The pre-existing deeper
readiness failure still responds 503 and requires private provider diagnostics.
Full authenticated deletion and real-device push remain unverified. This release
deploys the focused fixes; it does not close the full audit.

The preparation statement below describes work before deployment approval.

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
- Verify real iOS/Android delivery and full authenticated account deletion.
- Independent heartbeat/uptime alerts, backed-up database and Storage restore
  evidence, provider patch availability and commercial hosting eligibility.
- Load envelope, Ghana-device performance and targeted query-plan/index work.
- Consent configuration and owner recovery/admin access evidence.

Do not weaken readiness to return 200, add every suggested index, buy/upgrade a
plan, export production personal data, rotate credentials, or change provider
billing as part of this batch without the necessary access and decisions.
