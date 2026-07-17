-- Batch 15 (consolidated data model) gap closure. Additive only: indexes
-- the audit found missing against the spec's §26/§27 access patterns and the
-- batch-14 sweep queries. No schema shape changes.

-- Expiry sweeps: each sweep filters .lt(time) + .in(status). These tables
-- had one or neither half indexed.
create index if not exists meeting_pings_expiry_idx on public.meeting_pings(status, expires_at);
create index if not exists muddy_drops_expiry_idx on public.muddy_drops(status, expires_at);
create index if not exists invite_links_expiry_idx on public.invite_links(status, expires_at);
-- The expiry.plans completion job (added in the wiring pass) sweeps on these.
create index if not exists plans_completion_sweep_idx on public.plans(status, end_at);
-- visibility_sessions sweeps on ends_at (NOT expires_at — see handler fix).
create index if not exists visibility_sessions_ends_idx on public.visibility_sessions(status, ends_at);

-- §27 partial indexes for the hot read paths.
create index if not exists notifications_unread_idx
  on public.notifications(user_id, created_at desc)
  where is_read = false;

create index if not exists messages_undeleted_idx
  on public.messages(conversation_id, created_at desc)
  where deleted_at is null;

create index if not exists friendships_active_pair_idx
  on public.friendships(user_one_id, user_two_id)
  where ended_at is null;

create index if not exists subscriptions_paid_access_idx
  on public.subscriptions(user_id)
  where status in ('active', 'trialing', 'past_due', 'non_renewing', 'attention');

-- Hangout discovery feed (wiring pass): active sessions by owner set.
create index if not exists hangout_sessions_feed_idx
  on public.hangout_sessions(owner_id, ends_at)
  where status = 'active';
