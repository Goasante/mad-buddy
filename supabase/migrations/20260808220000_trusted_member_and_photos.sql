-- Trusted Member badge, and extra profile photos.
--
-- Two independent features, together because both extend the profile surface.

-- ---------------------------------------------------------------------------
-- 1. Trusted Member applications.
-- ---------------------------------------------------------------------------
-- DELIBERATELY NOT `account_verifications`. That table models email, phone,
-- institution and organisation checks — evidence that someone IS who they say.
-- This is a different claim entirely: a long-standing, fully engaged member
-- that staff chose to recognise. Storing them together would blur the two,
-- and the whole point of the name "Trusted Member" is that it never implies
-- an identity check.
--
-- The badge is APPLIED FOR, not granted automatically. Eligibility (premium
-- tenure plus every journey step) only earns the right to ask; a human still
-- approves. That is what keeps it a mark of standing rather than a purchase.

create table if not exists public.trusted_member_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  status text not null default 'pending' check (
    status in ('pending', 'approved', 'declined', 'revoked')
  ),

  -- The applicant's own words. Optional: eligibility is measured, not argued.
  note text check (char_length(note) <= 500),

  -- What was TRUE AT THE MOMENT OF APPLYING, captured rather than recomputed.
  -- A reviewer weeks later must see what the applicant qualified on, not a
  -- fresh reading that may have drifted — and an approval must stay
  -- explicable after the fact.
  premium_days_at_apply integer,
  journeys_complete_at_apply integer,

  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  -- Why it was declined or revoked. Never shown verbatim to the applicant:
  -- the product tells them the outcome, staff keep the reasoning.
  review_note text check (char_length(review_note) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One live application per person. A re-application after a decline updates
  -- this row rather than queueing a second, so nobody can flood the queue.
  constraint trusted_member_applications_unique unique (user_id)
);

create index if not exists trusted_member_applications_pending_idx
  on public.trusted_member_applications(created_at)
  where status = 'pending';

alter table public.trusted_member_applications enable row level security;

-- An applicant may read their own application and create it. They may NOT
-- update it: status, reviewer and review note are staff decisions, and a
-- policy letting the subject write them would make the badge self-granted.
create policy "own trusted application readable" on public.trusted_member_applications
  for select using (auth.uid() = user_id);

create policy "own trusted application insertable" on public.trusted_member_applications
  for insert with check (auth.uid() = user_id and status = 'pending');

-- The approved badge itself, denormalised onto the profile so every surface
-- that already reads a profile gets it without a join.
alter table public.profiles
  add column if not exists trusted_member_since timestamptz;

comment on column public.profiles.trusted_member_since is
  'When staff approved this account as a Trusted Member. NOT an identity check: it recognises tenure and engagement, never that the person is who they claim.';

-- ---------------------------------------------------------------------------
-- 2. Extra profile photos.
-- ---------------------------------------------------------------------------
-- Three beyond the avatar. The avatar stays on `profiles.avatar_url` and is
-- untouched — it is the identity everywhere in the product, and folding it
-- into a gallery would make every avatar read a second table.
--
-- Visibility is PER PHOTO, using the same vocabulary as
-- `profile_field_privacy` so one idea has one set of words. A person may show
-- one photo to everyone and keep another for Muddies.

create table if not exists public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,

  -- 0, 1, 2. Carousel order, and the cap.
  position integer not null check (position between 0 and 2),

  visibility text not null default 'approved_muddies' check (
    visibility in ('everyone', 'approved_muddies', 'only_me')
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One photo per slot. Replacing a photo updates its slot rather than
  -- growing the row count, so the cap is structural rather than enforced by
  -- application code that could forget.
  constraint profile_photos_unique_slot unique (user_id, position)
);

create index if not exists profile_photos_user_idx
  on public.profile_photos(user_id, position);

alter table public.profile_photos enable row level security;

-- The owner has full control of their own gallery.
create policy "own photos manageable" on public.profile_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Everyone-visible photos are readable by any signed-in user.
--
-- Muddies-only and only-me are NOT covered here. Postgres ORs permissive
-- policies, and expressing "is this viewer an approved Muddy" needs the
-- friendship join plus block and ghost checks that already live in the
-- server's profile loader. Adding a second, drifting copy of those rules in
-- a policy is how the two disagree. So RLS grants the unambiguous case, and
-- the loader decides the rest — the same arrangement UpFor discovery uses.
create policy "public photos readable" on public.profile_photos
  for select using (
    visibility = 'everyone'
    and auth.uid() is not null
  );

comment on column public.profile_photos.visibility is
  'Per photo, using profile_field_privacy vocabulary. Only the everyone case is granted by RLS; muddies-only is resolved by the server profile loader, which already owns friendship, block and ghost rules.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--   drop table if exists public.profile_photos;
--   drop table if exists public.trusted_member_applications;
--   alter table public.profiles drop column if exists trusted_member_since;
