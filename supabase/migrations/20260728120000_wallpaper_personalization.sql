-- Wallpaper personalization (Settings → Appearance → Wallpaper).
--
-- Three pieces:
--   1. public.wallpapers        — the canonical catalog (bundled seed + future
--      Admin-managed rows). Tier gating (free/buddy_plus/buddy_pro) lives here
--      as data so Admin can re-tier a wallpaper without a code deploy.
--   2. public.user_wallpaper_preferences — one row per user: the slug they
--      picked ('mad-buddy-default', 'plain', a catalog slug, or the sentinel
--      'custom'). Cosmetic, so a downgrade leaves the row alone; the renderer
--      falls back safely (see lib/wallpapers/catalog.ts).
--   3. public.custom_wallpapers — metadata ONLY for premium personal uploads.
--      The image bytes live in the private 'wallpapers' storage bucket; this
--      table stores just the storage key and dimensions, never the raw image.
--
-- Access is server-authoritative: entitlement is checked in the server action
-- before any preference write or signed-URL issue. RLS below is defense in
-- depth — a user can read their own preference/uploads and nobody else's, and
-- writes are service-role only.

-- ---------------------------------------------------------------------------
-- 1. Catalog
-- ---------------------------------------------------------------------------
create table if not exists public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 64),
  name text not null check (char_length(name) between 1 and 80),
  render_mode text not null check (render_mode in ('ambient', 'plain', 'image')),
  tier text not null default 'free' check (tier in ('free', 'buddy_plus', 'buddy_pro')),
  thumb_url text,
  light_url text,
  dark_url text,
  is_enabled boolean not null default true,
  sort_order integer not null default 100,
  source text not null default 'managed' check (source in ('bundled', 'managed', 'custom')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wallpapers_enabled_sort_idx on public.wallpapers(is_enabled, sort_order);

alter table public.wallpapers enable row level security;

-- Any signed-in user may read the *enabled* catalog to render the picker; tier
-- locks are presentation-only (an above-plan wallpaper still shows, greyed).
-- Disabled/retired rows are invisible to consumers. All writes are Admin-only
-- via the service role, so no insert/update/delete grant is given.
drop policy if exists "enabled wallpapers readable" on public.wallpapers;
create policy "enabled wallpapers readable" on public.wallpapers
  for select using (is_enabled = true);

revoke insert, update, delete on table public.wallpapers from anon, authenticated;

-- Seed the bundled catalog. on conflict keeps Admin edits intact on re-run and
-- never clobbers tier/enabled changes made later.
insert into public.wallpapers (slug, name, render_mode, tier, thumb_url, light_url, dark_url, sort_order, source)
values
  ('mad-buddy-default', 'Mad Buddy Default', 'ambient', 'free', null, null, null, 0, 'bundled'),
  ('plain', 'Plain', 'plain', 'free', null, null, null, 1, 'bundled'),
  ('wallpaper-01', 'Wallpaper 1', 'image', 'free', '/wallpapers/gallery/thumbs/wallpaper-01.webp', '/wallpapers/gallery/wallpaper-01.webp', '/wallpapers/gallery/wallpaper-01.webp', 2, 'bundled'),
  ('wallpaper-02', 'Wallpaper 2', 'image', 'free', '/wallpapers/gallery/thumbs/wallpaper-02.webp', '/wallpapers/gallery/wallpaper-02.webp', '/wallpapers/gallery/wallpaper-02.webp', 3, 'bundled'),
  ('wallpaper-03', 'Wallpaper 3', 'image', 'free', '/wallpapers/gallery/thumbs/wallpaper-03.webp', '/wallpapers/gallery/wallpaper-03.webp', '/wallpapers/gallery/wallpaper-03.webp', 4, 'bundled'),
  ('wallpaper-04', 'Wallpaper 4', 'image', 'free', '/wallpapers/gallery/thumbs/wallpaper-04.webp', '/wallpapers/gallery/wallpaper-04.webp', '/wallpapers/gallery/wallpaper-04.webp', 5, 'bundled')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Per-user preference
-- ---------------------------------------------------------------------------
create table if not exists public.user_wallpaper_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_slug text not null default 'mad-buddy-default' check (char_length(selected_slug) between 1 and 64),
  updated_at timestamptz not null default now()
);

alter table public.user_wallpaper_preferences enable row level security;

-- An owner may read their own preference (the app resolves it server-side with
-- the service role; a direct client read stays scoped to the owner). Writes go
-- through the server action under the service role AFTER the entitlement check,
-- so no write grant is given to anon/authenticated — a Free user cannot poke a
-- premium slug straight into their row.
drop policy if exists "own wallpaper preference readable" on public.user_wallpaper_preferences;
create policy "own wallpaper preference readable" on public.user_wallpaper_preferences
  for select using (auth.uid() = user_id);

revoke insert, update, delete on table public.user_wallpaper_preferences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Custom personal wallpapers (premium) — metadata only
-- ---------------------------------------------------------------------------
create table if not exists public.custom_wallpapers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null unique,
  mime_type text not null check (mime_type in ('image/webp', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0),
  width integer,
  height integer,
  state text not null default 'active' check (state in ('active', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active personal wallpaper per owner (a new upload supersedes).
create unique index if not exists custom_wallpapers_one_active_per_owner
  on public.custom_wallpapers(owner_id) where (state = 'active');
create index if not exists custom_wallpapers_owner_idx on public.custom_wallpapers(owner_id);

alter table public.custom_wallpapers enable row level security;

drop policy if exists "own custom wallpapers readable" on public.custom_wallpapers;
create policy "own custom wallpapers readable" on public.custom_wallpapers
  for select using (auth.uid() = owner_id);

revoke insert, update, delete on table public.custom_wallpapers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Private storage for custom uploads (signed reads only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('wallpapers', 'wallpapers', false)
on conflict (id) do nothing;

-- Objects are foldered by owner id: `<uid>/<file>`. A user can only touch their
-- own folder; reads are served via short-lived signed URLs from the server, so
-- User A can never reach User B's personal wallpaper even with the storage API.
drop policy if exists "wallpaper owner writes" on storage.objects;
create policy "wallpaper owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpaper owner reads" on storage.objects;
create policy "wallpaper owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpaper owner updates" on storage.objects;
create policy "wallpaper owner updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "wallpaper owner deletes" on storage.objects;
create policy "wallpaper owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text);
