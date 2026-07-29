-- Guided product tours (feature education), phase 1: canonical model + RLS +
-- the seeded main walkthrough.
--
-- Design notes:
--  * Versioned by construction. Eligibility is always "has this user already
--    resolved THIS tour_version", never a global boolean, so publishing v2
--    re-opens the tour to users who finished v1 without erasing v1 history.
--  * Steps are rows with their own uuid because product analytics dedupes on
--    (event_name, resource_type, resource_id, actor_id). Per-step ids are what
--    make step-level funnels/drop-off possible.
--  * No image blobs. `media_path` is a path only — bundled assets live under
--    public/tours/<slug>/, and any future admin upload uses object storage.
--  * Feature-flag and entitlement gating are stored as REFERENCES
--    (`requires_feature_flag`, `entitlement_keys`), never as copied capability
--    text, so the canonical flag/entitlement catalogs stay the only source of
--    truth for what a plan actually includes.
--  * Admin writes intentionally have no consumer-facing policy: mutations go
--    through the service-role client behind existing admin permissions.
-- Additive only.

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,64}$'),
  title text not null check (char_length(trim(title)) between 3 and 120),
  description text not null default '' check (char_length(description) <= 500),
  -- 'main' is the full walkthrough; 'feature' is a short mini-tour for a launch.
  kind text not null default 'feature' check (kind in ('main', 'feature')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tour_versions (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  -- Audience rules, evaluated by lib/tours/model.ts (pure + unit tested).
  -- Shape: { "plans": ["free","buddy_plus","buddy_pro"], "cohort": "all"|"new"|"existing" }
  audience jsonb not null default '{"plans": ["free", "buddy_plus", "buddy_pro"], "cohort": "all"}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tour_id, version),
  -- A published version must record when, so "new vs existing user" can be
  -- derived from signup date against publication rather than extra state.
  constraint tour_version_published_has_timestamp
    check (status <> 'published' or published_at is not null)
);

create index if not exists tour_versions_live_idx
  on public.tour_versions(status, published_at desc)
  where status = 'published';

create table if not exists public.tour_steps (
  id uuid primary key default gen_random_uuid(),
  tour_version_id uuid not null references public.tour_versions(id) on delete cascade,
  position integer not null check (position >= 1),
  step_key text not null check (step_key ~ '^[a-z0-9-]{2,64}$'),
  title text not null check (char_length(trim(title)) between 2 and 120),
  body text not null check (char_length(body) between 2 and 600),
  -- Stable targeting contract: matches a data-tour-id attribute in the app.
  -- Null means "no live element", i.e. render as a plain/media card.
  target_id text check (target_id is null or target_id ~ '^[a-z0-9-]{2,64}$'),
  -- Optional route to send the user to before showing this step.
  route text check (route is null or route ~ '^/[a-zA-Z0-9/_-]{0,120}$'),
  -- Bundled asset path under public/, e.g. /tours/main-app-v1/socialize.webp
  media_path text check (media_path is null or media_path ~ '^/tours/[a-zA-Z0-9/._-]{3,160}$'),
  cta_label text check (cta_label is null or char_length(trim(cta_label)) between 2 and 40),
  cta_href text check (cta_href is null or cta_href ~ '^/[a-zA-Z0-9/_-]{0,120}$'),
  -- Skip this step entirely when the named managed feature flag is off.
  requires_feature_flag text check (requires_feature_flag is null or requires_feature_flag ~ '^[a-z_]{3,48}$'),
  -- Entitlement keys this step explains. The UI renders real per-plan values
  -- from the canonical catalog; nothing about plan capability is stored here.
  entitlement_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (tour_version_id, position),
  unique (tour_version_id, step_key)
);

create index if not exists tour_steps_version_position_idx
  on public.tour_steps(tour_version_id, position);

create table if not exists public.user_tour_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tour_version_id uuid not null references public.tour_versions(id) on delete cascade,
  status text not null check (status in ('started', 'completed', 'skipped', 'dismissed')),
  -- Where to resume. Not a foreign key: a step removed by a later edit must
  -- degrade to "start from the beginning", never break the row.
  current_step_key text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  -- One row per user per version: this IS the "don't show the same version
  -- again" guarantee, enforced by the database rather than by app code.
  unique (user_id, tour_version_id)
);

create index if not exists user_tour_progress_user_idx
  on public.user_tour_progress(user_id);

alter table public.tours enable row level security;
alter table public.tour_versions enable row level security;
alter table public.tour_steps enable row level security;
alter table public.user_tour_progress enable row level security;

-- Consumers may read tour CONTENT only for published versions. Draft and
-- retired tours are invisible to the app entirely, so an unpublished draft can
-- never leak through the consumer read path.
drop policy if exists "tour versions readable when published" on public.tour_versions;
create policy "tour versions readable when published" on public.tour_versions
  for select to authenticated
  using (status = 'published');

drop policy if exists "tours readable when a version is published" on public.tours;
create policy "tours readable when a version is published" on public.tours
  for select to authenticated
  using (
    exists (
      select 1 from public.tour_versions v
      where v.tour_id = tours.id and v.status = 'published'
    )
  );

drop policy if exists "tour steps readable when version published" on public.tour_steps;
create policy "tour steps readable when version published" on public.tour_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.tour_versions v
      where v.id = tour_steps.tour_version_id and v.status = 'published'
    )
  );

-- Progress is owned by the user it belongs to, in both directions.
drop policy if exists "tour progress owner read" on public.user_tour_progress;
create policy "tour progress owner read" on public.user_tour_progress
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "tour progress owner insert" on public.user_tour_progress;
create policy "tour progress owner insert" on public.user_tour_progress
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "tour progress owner update" on public.user_tour_progress;
create policy "tour progress owner update" on public.user_tour_progress
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists tours_set_updated_at on public.tours;
create trigger tours_set_updated_at
  before update on public.tours
  for each row execute function public.set_updated_at();

drop trigger if exists tour_versions_set_updated_at on public.tour_versions;
create trigger tour_versions_set_updated_at
  before update on public.tour_versions
  for each row execute function public.set_updated_at();

drop trigger if exists user_tour_progress_set_updated_at on public.user_tour_progress;
create trigger user_tour_progress_set_updated_at
  before update on public.user_tour_progress
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: main-app-tour v1, published to everyone.
--
-- This is the temporary existing-user rollout from the brief, expressed as a
-- version rather than a "show to everyone forever" switch: cohort 'all' means
-- current users become eligible once, and their completion/skip is recorded
-- against v1 so it never repeats. A future v2 re-opens it without touching v1.
--
-- Steps that name a feature flag are skipped automatically when an Owner has
-- that feature disabled, so the tour never teaches unavailable functionality.
-- ---------------------------------------------------------------------------
insert into public.tours (slug, title, description, kind)
values (
  'main-app-tour',
  'Welcome to Mad Buddy',
  'A short walkthrough of how Mad Buddy works, from nearby glow to plans and privacy.',
  'main'
)
on conflict (slug) do nothing;

insert into public.tour_versions (tour_id, version, status, published_at, audience)
select
  t.id,
  1,
  'published',
  now(),
  '{"plans": ["free", "buddy_plus", "buddy_pro"], "cohort": "all"}'::jsonb
from public.tours t
where t.slug = 'main-app-tour'
on conflict (tour_id, version) do nothing;

insert into public.tour_steps (
  tour_version_id, position, step_key, title, body,
  target_id, route, requires_feature_flag, entitlement_keys, cta_label, cta_href
)
select v.id, s.position, s.step_key, s.title, s.body,
       s.target_id, s.route, s.requires_feature_flag, s.entitlement_keys, s.cta_label, s.cta_href
from public.tour_versions v
join public.tours t on t.id = v.tour_id and t.slug = 'main-app-tour'
cross join (values
  (1, 'welcome', 'Welcome to Mad Buddy',
   'Mad Buddy shows you when the people you trust are close by — without ever sharing anyone''s exact location. Here''s a quick look around.',
   null, '/dashboard', null, '{}'::text[], null, null),
  (2, 'nearby-glow', 'Nearby Muddies',
   'Approved Muddies glow here when they''re around. The stronger the glow, the closer they are.',
   'home-nearby', '/dashboard', null, '{}'::text[], null, null),
  (3, 'privacy', 'Your location stays yours',
   'Mad Buddy only ever shares approximate proximity — never your exact location, route or speed. Only approved Muddies can see your glow.',
   null, null, null, '{}'::text[], null, null),
  (4, 'muddies', 'Muddies',
   'These are your mutually approved friends. Proximity only ever works both ways, so no one can watch you one-sidedly.',
   'nav-friends', '/friends', null, '{}'::text[], null, null),
  (5, 'hangout', 'Hangout Mode',
   'Turn on Hangout Mode to let Muddies know you''re free right now, choose what you''re open to, and pick who can see it.',
   'nav-hangout-mode', '/hangout-mode', null, '{max_active_hangouts}'::text[], null, null),
  (6, 'socialize', 'Socialize',
   'Opt in for 30 minutes to a few hours to discover other people nearby who are also open to connecting. It switches itself off when the time runs out.',
   'nav-discover', '/discover', 'socialize', '{}'::text[], null, null),
  (7, 'safe-arrival', 'Safe Arrival',
   'Heading somewhere? Let trusted Muddies check that you got there. They see your destination label and expected time — never live location.',
   null, '/safe-arrival', null, '{}'::text[], null, null),
  (8, 'messages', 'Messages',
   'Chat with your Muddies, in one-to-one conversations or group chats attached to a plan.',
   'nav-messages', '/messages', null, '{}'::text[], null, null),
  (9, 'plans', 'Plans',
   'Make something happen. Invite Muddies, track who''s coming, and keep the conversation in one place.',
   'nav-plans', '/plans', null, '{max_plan_participants}'::text[], null, null),
  (10, 'pulse', 'Pulse',
   'Your updates live here — requests, plan changes and nearby alerts, grouped so nothing important gets lost.',
   'nav-notifications', '/notifications', null, '{}'::text[], null, null),
  -- Wallpaper access is gated by wallpaper TIER (lib/wallpapers/catalog.ts
  -- canAccessTier), not by an entitlement key, so this step deliberately
  -- names none rather than inventing one that does not exist.
  (11, 'personalization', 'Make Mad Buddy yours',
   'Pick a wallpaper to change how the whole app feels. Some are included on every plan, and more unlock as you upgrade.',
   null, '/settings/appearance/wallpaper', null, '{}'::text[], null, null),
  (12, 'plans-and-pricing', 'Buddy Plus and Buddy Pro',
   'Mad Buddy works on the free plan. Upgrading raises your limits — here is exactly what changes.',
   null, null, null, '{max_muddies,max_active_hangouts,max_plan_participants}'::text[], 'See plans', '/upgrade'),
  (13, 'ready', 'You''re ready',
   'That''s the tour. You can take it again any time from Settings.',
   null, null, null, '{}'::text[], null, null)
) as s(position, step_key, title, body, target_id, route, requires_feature_flag, entitlement_keys, cta_label, cta_href)
where v.version = 1
on conflict (tour_version_id, position) do nothing;
