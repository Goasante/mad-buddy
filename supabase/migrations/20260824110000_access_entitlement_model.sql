-- Mad Buddy Access — one entitlement authority for Linkr and UpFor.
--
-- WHY THIS SHAPE.
--
-- The product rule is: your existing social world is free, expanding it is paid.
-- Exactly two surfaces are paid (Linkr, UpFor); everything else is free forever.
--
-- The existing system is the opposite shape. It ranks three tiers
-- (free < buddy_plus < buddy_pro) and caps the FREE CORE -- plans, groups,
-- circles, event circles, plan-chat archive -- while Linkr has no billing
-- reference anywhere and UpFor's catalog limits are enforced nowhere. Renaming
-- that model would preserve its central mistake: a single ranked "how premium
-- is this user" number, consulted ad hoc, which is the scattered `isPremium`
-- pattern this migration exists to end.
--
-- So access is modelled as INDEPENDENT SOURCES, not a rank. A person may hold
-- several at once (a paid subscription AND an admin grant AND welcome access).
-- Access is the union: true if ANY source is currently valid. Revoking one
-- never destroys another -- the property a precedence ladder gets wrong, and
-- the one the brief calls out by name.
--
-- Three tables, by responsibility, rather than one mega-table:
--
--   access_grants       per-user, append-mostly: welcome access, admin grants,
--                       staff, promos. One row per grant, never overwritten.
--   access_global_windows  one row per "everybody gets access" period, so a
--                       global promo costs ONE row rather than N user rows.
--   subscriptions       ALREADY EXISTS. Provider state (Paystack today, Apple
--                       and Google later). Left alone by this migration.
--
-- No `profiles.is_premium`, no `linkr_enabled`, no derived boolean anywhere.
-- Current state is a QUESTION ASKED OF THIS DATA AT SERVER TIME, never a cached
-- flag that can drift from it.

-- ---------------------------------------------------------------------------
-- 1. Access sources, named once.
-- ---------------------------------------------------------------------------
-- Provider-neutral from the start. `apple_subscription` and `google_subscription`
-- exist as source types with no implementation behind them -- the schema must
-- not have to change when native ships, but nothing here pretends they work.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_source') then
    create type public.access_source as enum (
      'welcome_access',
      'web_subscription',
      'apple_subscription',
      'google_subscription',
      'admin_grant',
      'staff',
      'global_promo'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Per-user access grants.
-- ---------------------------------------------------------------------------
-- APPEND-MOSTLY BY DESIGN. A grant is a historical fact: "this access was
-- given, by this actor, for this reason, for this window." Revoking sets
-- `revoked_at`; it never deletes the row and never rewrites `expires_at`,
-- because "who gave someone access and when" is exactly the question an audit
-- asks after something goes wrong.
create table if not exists public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source public.access_source not null,

  starts_at timestamptz not null default now(),
  -- NULL means indefinite. Used by staff access and by "until revoked" grants.
  -- An indefinite grant is still revocable; it just has no scheduled end.
  expires_at timestamptz,

  -- Who did this, and why. `granted_by` is null for system-created grants
  -- (welcome access), non-null for anything a human did.
  granted_by uuid references auth.users(id) on delete set null,
  reason text,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text,

  -- Free-form provenance (e.g. the promo campaign, the support ticket).
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint access_grants_window_valid
    check (expires_at is null or expires_at > starts_at),
  -- Revocation is a pair: both columns or neither. Prevents a half-written
  -- revocation reading as still-active.
  constraint access_grants_revocation_paired
    check ((revoked_at is null) = (revoked_by is null))
);

-- WELCOME ACCESS STARTS EXACTLY ONCE, ENFORCED BY THE DATABASE.
--
-- This partial unique index is the whole anti-abuse story. It cannot be reset
-- by clearing cookies, reinstalling, logging out, or switching device, because
-- none of those things can delete a row keyed on `user_id`. No device
-- fingerprinting is needed or used -- the identity anchor is the account.
create unique index if not exists access_grants_one_welcome_per_user
  on public.access_grants (user_id)
  where source = 'welcome_access';

create index if not exists access_grants_user_active_idx
  on public.access_grants (user_id, expires_at)
  where revoked_at is null;

comment on table public.access_grants is
  'Per-user Mad Buddy Access grants. Append-mostly: revoking sets revoked_at, never deletes. One welcome_access row per user, enforced by a partial unique index.';

-- ---------------------------------------------------------------------------
-- 3. Global access windows.
-- ---------------------------------------------------------------------------
-- "Give everyone Linkr and UpFor for a month" must cost ONE row, not one row
-- per user. Mass-updating users would also destroy the fallback property: when
-- the window ends every person must drop back to whatever they independently
-- hold, which is only possible if the global window never touched their rows.
create table if not exists public.access_global_windows (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,          -- NULL = until revoked

  created_by uuid not null references auth.users(id) on delete restrict,
  reason text not null,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text,

  created_at timestamptz not null default now(),

  constraint access_global_windows_window_valid
    check (expires_at is null or expires_at > starts_at),
  constraint access_global_windows_revocation_paired
    check ((revoked_at is null) = (revoked_by is null))
);

create index if not exists access_global_windows_active_idx
  on public.access_global_windows (starts_at, expires_at)
  where revoked_at is null;

comment on table public.access_global_windows is
  'Periods where Mad Buddy Access is open to everyone. One row per window -- never mass-updates user rows, so ending a window restores each person to their own sources.';

-- ---------------------------------------------------------------------------
-- 4. Welcome Access starts at first_muddy_added, in the database.
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER ON `friendships` AND NOT APPLICATION CODE.
--
-- `first_muddy_added` is recorded today by one application path
-- (lib/friends/service.ts, on accepting a request). But friendships are created
-- inside RPCs (`accept_friend_request`, the relationship-lifecycle RPC), and any
-- future path that creates one would silently fail to start the clock. The
-- database is the one place every friendship passes through.
--
-- WHY 14 DAYS FROM THE FRIENDSHIP, NOT FROM SIGNUP.
--
-- An auth row can exist before there is any product identity, and onboarding
-- completion is still setup. `first_muddy_added` requires ANOTHER PERSON to
-- agree, so it is the first moment the product has demonstrably delivered
-- something. This is already product-audited and is not re-litigated here.
--
-- REACTIVATION IS NOT A NEW FIRST MUDDY. The friendships upsert reuses the same
-- row when a relationship is restored (`on conflict ... do update set
-- ended_at = null`), so this fires on INSERT and on that reactivating UPDATE --
-- but `on conflict do nothing` against the partial unique index means a
-- returning user never gets a second welcome window.
create or replace function public.start_welcome_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration_days integer := 14;
begin
  -- Only an ACTIVE friendship starts the clock. An ended one is not a Muddy.
  if new.ended_at is not null then
    return new;
  end if;

  -- Both sides of the friendship reached first_muddy_added at this moment.
  insert into public.access_grants (user_id, source, starts_at, expires_at, reason)
  select
    u.user_id,
    'welcome_access',
    now(),
    now() + make_interval(days => v_duration_days),
    'Welcome Access started at first_muddy_added'
  from (values (new.user_one_id), (new.user_two_id)) as u(user_id)
  -- The partial unique index makes this idempotent: a person who already has a
  -- welcome grant keeps their ORIGINAL window. Deleting cookies, reinstalling,
  -- or making a second Muddy cannot extend or restart it.
  on conflict (user_id) where source = 'welcome_access' do nothing;

  return new;
end;
$$;

revoke all on function public.start_welcome_access() from public, anon, authenticated;

drop trigger if exists friendships_start_welcome_access on public.friendships;
create trigger friendships_start_welcome_access
  after insert or update of ended_at on public.friendships
  for each row
  execute function public.start_welcome_access();

-- ---------------------------------------------------------------------------
-- 5. Row level security.
-- ---------------------------------------------------------------------------
-- THE INVARIANT: a user may READ their own access, and may never write it.
--
-- There is no user-facing INSERT, UPDATE or DELETE policy on either table. With
-- RLS enabled and no permissive policy for a command, that command is denied --
-- so self-granting, extending one's own `expires_at`, and un-revoking a
-- revocation are all impossible through the RLS client regardless of what the
-- application does. Writes happen only through the service role, behind
-- authorization checks that live in the admin layer.
alter table public.access_grants enable row level security;
alter table public.access_global_windows enable row level security;

drop policy if exists "access grants visible to the owner" on public.access_grants;
create policy "access grants visible to the owner" on public.access_grants
  for select using (auth.uid() = user_id);

-- Global windows are readable by any signed-in user: the Settings page has to
-- be able to explain WHY someone currently has access, and a window is not
-- private information -- it applies to everybody by definition. `reason` is
-- written by admins and is shown to nobody; the resolver reads it, the UI
-- reports only that a promotion is active.
drop policy if exists "global windows visible to signed-in users" on public.access_global_windows;
create policy "global windows visible to signed-in users" on public.access_global_windows
  for select using (auth.uid() is not null);

-- ROLLBACK (for the production application order; not run here):
--
--   drop trigger if exists friendships_start_welcome_access on public.friendships;
--   drop function if exists public.start_welcome_access();
--   drop table if exists public.access_grants;
--   drop table if exists public.access_global_windows;
--   drop type if exists public.access_source;
--
-- Rolling back removes all access records. The resolver treats "no sources" as
-- no access, so a rollback locks Linkr and UpFor rather than opening them --
-- it fails closed. Restore from backup if grants must survive.
