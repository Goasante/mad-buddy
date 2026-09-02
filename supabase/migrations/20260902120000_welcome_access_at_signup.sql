-- ---------------------------------------------------------------------------
-- Welcome Access starts at SIGNUP, not only at the first Muddy.
-- ---------------------------------------------------------------------------
-- WHAT CHANGED AND WHY.
--
-- 20260824110000 started the 14-day window at `first_muddy_added`, reasoning
-- that a friendship is the first moment the product has demonstrably delivered
-- something. That reasoning is sound, but it produced a result nobody intended:
-- a person who signs up and opens UpFor or Linkr before adding anyone has no
-- grant at all, so the very first thing a new user sees is a payment screen.
-- Reported from production.
--
-- The window now opens when the account exists. The first-Muddy trigger is
-- KEPT, not replaced -- see below.
--
-- WHY BOTH TRIGGERS.
--
-- The partial unique index `access_grants_one_welcome_per_user` means whichever
-- fires first wins and the second is a no-op, so "whichever comes first" is the
-- behaviour without any coordination between them. Keeping the friendship
-- trigger matters for accounts that already exist: somebody who signed up
-- yesterday and adds their first Muddy tomorrow still gets their window, and
-- nobody mid-window has it moved or shortened.
--
-- WHY A TRIGGER ON `profiles` AND NOT APPLICATION CODE.
--
-- Same argument the original migration made for friendships. Accounts are
-- created through lib/auth/bootstrap.ts today, but admin account creation and
-- any future path also insert a profile row, and each would silently fail to
-- start the clock. `profiles` is the one row every account has -- the bootstrap
-- deletes the auth user outright if the profile insert fails, so there is no
-- such thing as an account without one.
--
-- WHY NOT auth.users. A trigger there would fire before the product identity
-- exists and needs privileges on a schema this project otherwise leaves alone.
--
-- NOT RETROACTIVE. This grants nothing to existing accounts. Backfilling would
-- hand a fresh 14 days to people who signed up months ago and to anyone whose
-- window has already been used, which is a giveaway decision, not a migration.

create or replace function public.start_welcome_access_at_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration_days integer := 14;
begin
  insert into public.access_grants (user_id, source, starts_at, expires_at, reason)
  values (
    new.user_id,
    'welcome_access',
    now(),
    now() + make_interval(days => v_duration_days),
    'Welcome Access started at signup'
  )
  -- Idempotent against the same partial unique index the friendship trigger
  -- relies on. A profile upsert that runs twice, or a person who somehow
  -- reaches the friendship path first, keeps their ORIGINAL window.
  on conflict (user_id) where source = 'welcome_access' do nothing;

  return new;
end;
$$;

revoke all on function public.start_welcome_access_at_signup() from public, anon, authenticated;

drop trigger if exists profiles_start_welcome_access on public.profiles;
create trigger profiles_start_welcome_access
  after insert on public.profiles
  for each row
  execute function public.start_welcome_access_at_signup();

comment on function public.start_welcome_access_at_signup() is
  'Opens the 14-day Welcome Access window when an account is created. Paired with start_welcome_access() on friendships; the partial unique index makes whichever fires first the only one that counts.';
