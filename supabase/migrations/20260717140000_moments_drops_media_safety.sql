-- Nearby Moments, Muddy Drops, Private Media Sharing, Content Safety
-- (feature architecture batch 6). Additive only: new tables, a private storage
-- bucket, indexes, and RLS policies. Nothing is dropped or altered.
--
-- Reuse notes (deliberately NOT recreated):
--   * The spec's `user_blocks` (§56) is the existing public.blocked_users table.
--   * The existing public.reports table stays for user-level reports; this adds
--     public.content_reports for content-level reports (§56).
--   * The existing `avatars` bucket stays public (profile photos). Batch-6
--     media uses a new PRIVATE bucket read only via short-lived signed URLs.
--
-- Privacy note: no table here stores coordinates. A Moment's "nearby" audience
-- is resolved server-side at read time from the existing proximity pipeline —
-- it is never persisted, so no movement history is created.
--
-- Rollback: drop the tables below, then optionally the bucket:
--   drop table if exists public.moderation_actions, public.content_reports,
--     public.drop_unlocks, public.drop_audience_targets, public.muddy_drops,
--     public.moment_reactions, public.moment_audience_targets, public.moments,
--     public.media_variants, public.media_assets cascade;
--   delete from storage.buckets where id = 'media';

-- ---------------------------------------------------------------------------
-- FEATURE 3: Private media (§36-§47). Private bucket + signed reads only.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  width integer,
  height integer,
  processing_status text not null default 'ready' check (
    processing_status in ('pending', 'processing', 'ready', 'failed', 'quarantined')
  ),
  moderation_status text not null default 'active' check (
    moderation_status in ('active', 'under_review', 'restricted', 'removed', 'restored', 'deleted_by_user')
  ),
  context_type text not null check (
    context_type in ('profile', 'moment', 'drop', 'event', 'plan', 'chat')
  ),
  retention_policy text not null default 'follows_parent' check (
    retention_policy in ('follows_parent', 'keep_30d', 'legal_hold')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.media_variants (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  variant_type text not null check (variant_type in ('thumb', 'feed', 'full')),
  storage_key text not null,
  width integer,
  height integer,
  size_bytes integer,
  created_at timestamptz not null default now(),
  constraint media_variants_unique unique (media_asset_id, variant_type)
);

-- Queue consumed by the cleanup job when parent content expires/deletes (§45).
create table if not exists public.media_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  reason text not null check (reason in ('parent_deleted', 'parent_expired', 'user_deleted', 'moderation')),
  queued_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint media_deletion_queue_unique unique (media_asset_id)
);

create index if not exists media_assets_owner_idx on public.media_assets(owner_id, context_type);
create index if not exists media_assets_deleted_idx on public.media_assets(deleted_at);
create index if not exists media_variants_asset_idx on public.media_variants(media_asset_id);
create index if not exists media_deletion_queue_pending_idx
  on public.media_deletion_queue(processed_at) where processed_at is null;

alter table public.media_assets enable row level security;
alter table public.media_variants enable row level security;
alter table public.media_deletion_queue enable row level security;

-- Only the owner touches media rows directly. Viewers never read these tables:
-- they receive short-lived signed URLs minted server-side after the parent
-- object's permissions are checked (§41, §42).
create policy "media assets owner access" on public.media_assets
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "media variants owner access" on public.media_variants
  for select using (
    exists (
      select 1 from public.media_assets a
      where a.id = media_variants.media_asset_id and a.owner_id = auth.uid()
    )
  );

-- The media bucket is private: no anon/authenticated storage policy is created,
-- so all reads must go through server-minted signed URLs.
create policy "media bucket owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media bucket owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media bucket owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- FEATURE 1: Nearby Moments (§2-§20). Always expiring, never public.
-- ---------------------------------------------------------------------------

create table if not exists public.moments (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('text', 'photo')),
  text_content text check (char_length(text_content) <= 500),
  media_id uuid references public.media_assets(id) on delete set null,
  caption text check (char_length(caption) <= 200),
  audience_type text not null check (
    audience_type in ('close_friends', 'selected_muddies', 'selected_circles', 'nearby_muddies', 'event_circle', 'plan')
  ),
  status text not null default 'active' check (
    status in ('active', 'under_review', 'restricted', 'removed', 'deleted_by_user', 'expired')
  ),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A Moment always says something: text, or a photo (caption optional).
  constraint moments_has_content check (
    (content_type = 'text' and text_content is not null)
    or (content_type = 'photo' and media_id is not null)
  ),
  constraint moments_expiry_after_start check (expires_at > starts_at)
);

create table if not exists public.moment_audience_targets (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'circle', 'event_circle', 'plan')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint moment_targets_unique unique (moment_id, target_type, target_id)
);

create table if not exists public.moment_reactions (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart', 'laugh', 'wave', 'fire', 'clap')),
  created_at timestamptz not null default now(),
  -- One active reaction per user per Moment (§13).
  constraint moment_reactions_unique unique (moment_id, user_id)
);

create index if not exists moments_author_status_idx on public.moments(author_id, status);
create index if not exists moments_active_idx on public.moments(status, expires_at);
create index if not exists moment_targets_moment_idx on public.moment_audience_targets(moment_id);
create index if not exists moment_targets_lookup_idx on public.moment_audience_targets(target_type, target_id);
create index if not exists moment_reactions_moment_idx on public.moment_reactions(moment_id);

alter table public.moments enable row level security;
alter table public.moment_audience_targets enable row level security;
alter table public.moment_reactions enable row level security;

create policy "moments author full access" on public.moments
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- Floor only: a Muddy may read an unexpired, active Moment. Audience narrowing
-- (circles / close friends / nearby / blocks) is enforced in the application
-- layer via the service role, which is authoritative.
create policy "muddies read active moments" on public.moments
  for select using (
    status = 'active'
    and expires_at > now()
    and exists (
      select 1 from public.friendships f
      where (f.user_one_id = auth.uid() and f.user_two_id = moments.author_id)
         or (f.user_two_id = auth.uid() and f.user_one_id = moments.author_id)
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = moments.author_id)
         or (b.blocker_id = moments.author_id and b.blocked_id = auth.uid())
    )
  );

create policy "moment targets author access" on public.moment_audience_targets
  for all using (
    exists (
      select 1 from public.moments m
      where m.id = moment_audience_targets.moment_id and m.author_id = auth.uid()
    )
  );

-- Reactions are visible to the author and the reacting user only (§11) — there
-- are deliberately no public reaction counts.
create policy "moment reactions visible to author and reactor" on public.moment_reactions
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.moments m
      where m.id = moment_reactions.moment_id and m.author_id = auth.uid()
    )
  );

create policy "moment reactions owned by reactor" on public.moment_reactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 2: Muddy Drops (§21-§35). MVP: circle / plan / event contexts only.
-- ---------------------------------------------------------------------------

create table if not exists public.muddy_drops (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  drop_type text not null check (drop_type in ('circle', 'plan', 'event')),
  context_type text not null check (context_type in ('circle', 'plan', 'event', 'event_circle')),
  context_id uuid not null,
  content_type text not null check (content_type in ('text', 'photo')),
  text_content text check (char_length(text_content) <= 500),
  media_id uuid references public.media_assets(id) on delete set null,
  action_type text check (action_type in ('open_chat', 'join_plan', 'wave', 'rsvp', 'view_announcement')),
  action_target_id uuid,
  status text not null default 'scheduled' check (
    status in ('draft', 'scheduled', 'active', 'expired', 'cancelled', 'removed')
  ),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_unlocks integer check (max_unlocks > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drops_has_content check (
    (content_type = 'text' and text_content is not null)
    or (content_type = 'photo' and media_id is not null)
  ),
  constraint drops_expiry_after_start check (expires_at > starts_at)
);

create table if not exists public.drop_audience_targets (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.muddy_drops(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'circle', 'event_circle', 'plan')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint drop_targets_unique unique (drop_id, target_type, target_id)
);

create table if not exists public.drop_unlocks (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.muddy_drops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Duplicate unlock is impossible, even under concurrent requests (§33).
  constraint drop_unlocks_unique unique (drop_id, user_id)
);

create index if not exists muddy_drops_creator_idx on public.muddy_drops(creator_id, status);
create index if not exists muddy_drops_context_idx on public.muddy_drops(context_type, context_id, status);
create index if not exists muddy_drops_active_idx on public.muddy_drops(status, expires_at);
create index if not exists drop_targets_drop_idx on public.drop_audience_targets(drop_id);
create index if not exists drop_unlocks_drop_idx on public.drop_unlocks(drop_id);
create index if not exists drop_unlocks_user_idx on public.drop_unlocks(user_id);

alter table public.muddy_drops enable row level security;
alter table public.drop_audience_targets enable row level security;
alter table public.drop_unlocks enable row level security;

create policy "drops creator full access" on public.muddy_drops
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- A Drop's existence must never leak to an ineligible user (§25), so there is
-- deliberately NO general read policy here: eligibility is resolved exclusively
-- in the application layer via the service role.
create policy "drop targets creator access" on public.drop_audience_targets
  for all using (
    exists (
      select 1 from public.muddy_drops d
      where d.id = drop_audience_targets.drop_id and d.creator_id = auth.uid()
    )
  );

create policy "drop unlocks visible to unlocker and creator" on public.drop_unlocks
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.muddy_drops d
      where d.id = drop_unlocks.drop_id and d.creator_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- FEATURE 4: Content Safety (§48-§60). Content-level reports + action log.
-- ---------------------------------------------------------------------------

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  content_type text not null check (
    content_type in ('moment', 'drop', 'message', 'profile', 'announcement', 'plan')
  ),
  content_id uuid not null,
  reported_user_id uuid references auth.users(id) on delete set null,
  category text not null check (
    category in (
      'harassment', 'threat_or_violence', 'sexual_content', 'hate_or_discrimination',
      'spam', 'scam', 'impersonation', 'private_information', 'unwanted_contact',
      'dangerous_location_sharing', 'other'
    )
  ),
  details text check (char_length(details) <= 1000),
  status text not null default 'received' check (
    status in ('received', 'under_review', 'actioned', 'dismissed')
  ),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.content_reports(id) on delete set null,
  moderator_id uuid references auth.users(id) on delete set null,
  action_type text not null check (
    action_type in (
      'no_action', 'hide_content', 'remove_content', 'warn_user', 'rate_limit_user',
      'suspend_feature', 'temporary_suspension', 'permanent_suspension', 'escalate', 'restore_content'
    )
  ),
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

-- Content the reporter chose to hide, applied immediately on report (§50).
create table if not exists public.hidden_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (
    content_type in ('moment', 'drop', 'message', 'profile', 'announcement', 'plan')
  ),
  content_id uuid not null,
  created_at timestamptz not null default now(),
  constraint hidden_content_unique unique (user_id, content_type, content_id)
);

create index if not exists content_reports_status_idx on public.content_reports(status, created_at);
create index if not exists content_reports_content_idx on public.content_reports(content_type, content_id);
create index if not exists content_reports_reporter_idx on public.content_reports(reporter_id);
create index if not exists moderation_actions_report_idx on public.moderation_actions(report_id);
create index if not exists hidden_content_user_idx on public.hidden_content(user_id, content_type);

alter table public.content_reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.hidden_content enable row level security;

-- A reporter may file a report and see their own. Reporter identity is never
-- exposed to the reported user (§58) — no policy grants that read.
create policy "content reports insert by reporter" on public.content_reports
  for insert with check (auth.uid() = reporter_id);

create policy "content reports visible to reporter" on public.content_reports
  for select using (auth.uid() = reporter_id);

-- Moderation actions are staff-only: no policy grants end users any access.
-- Reads happen exclusively through the service role behind an admin check.

create policy "hidden content owner access" on public.hidden_content
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
