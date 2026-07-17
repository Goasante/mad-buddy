# Mad Buddy Database Map (Batch 15)

The authoritative map of the **live** schema against the batch-15 consolidated
data model. The spec describes an idealised model; this document records how
each domain is actually realised, where we deliberately diverge, and why.
Per-table detail lives in `supabase/migrations/` (each migration is commented)
and `lib/supabase/database.types.ts` (hand-synced types).

## Domain → table map

| Spec domain | Live tables | Notes |
| --- | --- | --- |
| Identity | Supabase Auth (`auth.users`, sessions, tokens) | We do **not** own `users`/`sessions`/`verification_tokens` — Supabase Auth is the identity provider. `account_status` is realised as `user_restrictions` + `profiles.deleted_at`. |
| Profile | `profiles`, `profile_field_privacy`, `user_interests`, `onboarding_progress`, `activation_milestones` | Interests are free-text per user (no `interests` reference table yet). |
| Trust | `account_verifications`, `account_trust_events`, `discoverability_identifiers`, `contact_match_sessions` | Spec's `discoverability_settings` is not yet persisted (defaults applied in `lib/discovery/trust.ts`). |
| Relationships | `friend_requests`, `friendships`, `blocked_users` | `friendships` stores the canonical ordered pair (`user_one_id < user_two_id`, unique). Spec's `user_blocks` = `blocked_users`. |
| Circles | `friend_circles`, `circle_members`, `close_friend_relationships`, `best_buddies` | Spec's unified `circles`/`circle_memberships` with `circle_type` is split: personal circles here, event circles in the events domain. No workspace circles yet. |
| Privacy | `visibility_sessions`, `visibility_targets`, `status_visibility_targets`, `privacy_setup_versions`, `user_preferences` (JSON prefs) | Per-feature `visibility_preferences` rows are realised as JSON blobs on `user_preferences` + session rows. `visibility_sessions.ends_at` is the expiry column (null = until turned off). No `visibility_schedules` yet (paid feature, unbuilt). |
| Presence | `user_locations` (one row per user, upserted), `proximity_events` | Diverges from spec's `location_updates` log + `presence_state`: we keep only the **latest** location per user — stronger minimisation than a short-lived log. Freshness is computed, not stored. |
| Status | `user_statuses` (one active per user), `status_visibility_targets` | |
| Interactions | `waves`, `wave_mutes`, `meeting_pings`, `meeting_ping_responses`, `temporary_plans` | No `client_request_id` idempotency yet — dedupe is via pair cooldown (waves) and the `source_ping_id` unique (accepted pings). Candidate if double-sends are ever observed. |
| Plans | `plans`, `plan_participants`, `plan_polls`, `plan_poll_options`, `plan_poll_votes` | `plans.source_ping_id`/`source_hangout_id` are dedicated FKs, not polymorphic (§31 followed). Completion is driven by the `expiry.plans` job. |
| Hangouts | `hangout_sessions`, `hangout_audience_targets`, `hangout_requests` | |
| Messaging | `conversations`, `conversation_members`, `messages`, `message_reactions`, `message_hides`, `group_settings` | `messages(sender_id, client_message_id)` unique = send idempotency. Realtime via the `supabase_realtime` publication (migration 20260717300000). |
| Notifications | `notifications`, `push_subscriptions`, `notification_budget_usage`, `engagement_preferences`, prefs JSON on `user_preferences` | Delivery decision is computed per send in `deliverNotification` (category prefs → quiet hours → Exam Mode → budget). No `notification_delivery_attempts` — web-push failures self-heal by deleting gone subscriptions. |
| Media | `media_assets`, `media_variants`, `media_deletion_queue` | EXIF stripped and variants generated at upload (`lib/media/processing.ts`); originals never stored with metadata. |
| Moments/Drops | `moments`, `moment_audience_targets`, `moment_reactions`, `hidden_content`, `muddy_drops`, `drop_audience_targets`, `drop_unlocks` | |
| Events | `events`, `check_ins` (one active per context, partial unique), `event_circles`, `event_circle_members`, `event_announcements`, `qr_sessions` | Spec's `event_participants` is realised as check-ins; RSVP-style participation uses plans. |
| Safe Arrival | `safe_arrival_sessions`, `safe_arrival_contacts`, `safe_arrival_events`, `safe_arrival_blocks` | |
| Communities/Workspaces | — | **Not built.** `subscriptions.subject_type` already supports workspace/community subjects for when it is. |
| Billing | `subscriptions`, `subscription_changes`, `downgrade_adjustments`, `entitlement_overrides`, `promotion_codes`, `promotion_redemptions`, `paystack_webhook_events` | Plan entitlements are code (`lib/billing/entitlements.ts`), not a `plan_entitlements` table — reviewable, tested, versioned in git. Webhook idempotency via `paystack_webhook_events` unique id. |
| Moderation/Support | `content_reports`, `moderation_actions`, `trust_safety_cases`, `case_actions`, `case_evidence`, `support_tickets`, `support_ticket_messages`, `appeals`, `privacy_requests`, `user_restrictions` | |
| Admin/Ops | `admin_users` (legacy coarse), `admin_roles`, `admin_role_permissions`, `admin_assignments`, `admin_audit_events` (append-only), `sensitive_access_log`, `security_incidents`, `incident_actions`, `emergency_controls`, `feature_flags`, `feature_flag_rules` | |
| Jobs | `jobs`, `idempotency_keys`, `domain_events`, `rate_limits` | Cron tick every 5 min; periodic idempotency keys make double-ticks no-ops. |
| Engagement | `friendship_recaps`, `recap_preferences`, `friendship_streaks`, `streak_qualifying_events`, `achievement_definitions`, `user_achievements` | No cross-user read policies — leaderboards are impossible by construction. |

## Lifecycle and deletion (spec §23–§25)

- **Hard delete:** `user_statuses` (expiry sweep deletes), rate-limit windows,
  expired idempotency keys, gone push subscriptions, `user_locations` on
  deletion.
- **Soft delete / status flip:** messages (`deleted_at`), moments, drops,
  media (`deleted_at` + storage removal via `media_deletion_queue`), plans
  (`cancelled`/`completed`), friend requests (`expired`), event circles
  (`archived`), visibility sessions (`ended`).
- **Append-only:** `admin_audit_events`, `domain_events`,
  `sensitive_access_log`, `safe_arrival_events`.
- **Expiry jobs:** all in `lib/jobs/handlers.ts`, idempotent, driven by
  `/api/cron/tick`. Note: `visibility_sessions` expires on **`ends_at`** —
  the sweep's `timeColumn` override exists because of this.

## Conventions the schema enforces

- **IDs:** UUIDs everywhere (spec §34).
- **Timestamps:** UTC `timestamptz`; plan/user timezones stored separately
  (spec §33).
- **Canonical pairs:** friendships store `(low, high)` ordered UUIDs.
- **State machines:** enforced in `lib/**/rules.ts` (`canTransitionPlan`,
  `canTransitionSafeArrival`, `canTransitionEventCircle`,
  `resolveJoinEventCircle`, subscription `effectivePlan`), all unit-tested —
  never by unconstrained status updates (spec §28).
- **RLS:** every user-data table has owner-scoped policies; server actions go
  through the service role after explicit authorisation checks. Engagement
  and location tables deliberately have **no** cross-user read policy.
- **Polymorphic refs** (`context_type`/`context_id`) are used for check-ins,
  drops, conversations, media — each consumer re-resolves membership
  server-side before granting anything (spec §31's caution applied).

## Known deliberate gaps (future batches)

- Workspaces/communities domain (spec §18) — entire domain deferred.
- `discoverability_settings` persistence — defaults only.
- `visibility_schedules` — paid feature, unbuilt.
- Wave/ping `client_request_id` idempotency — deferred until double-sends are
  observed in practice.
- Interest reference table + curated categories — free text for MVP.
