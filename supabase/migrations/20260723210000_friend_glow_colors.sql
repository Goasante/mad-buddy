-- Custom glow colours (Buddy Plus / Pro entitlement `custom_glow_styles`).
--
-- A subscriber assigns a palette colour to a Muddy so that Muddy's proximity
-- glow renders in that colour. One colour per (owner, friend) pair. The value
-- is a palette id (see lib/glow/custom-colors.ts), never raw CSS, so nothing
-- user-controlled reaches the stylesheet.
--
-- The entitlement itself is enforced in the server action before any write;
-- this table just stores the choice. Colours are cosmetic, so a downgrade
-- leaves the rows in place and the renderer simply falls back to the default
-- glow (it does not delete anyone's data).
create table if not exists public.friend_glow_colors (
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  color_id text not null check (char_length(color_id) <= 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, friend_id)
);

create index if not exists friend_glow_colors_owner_idx on public.friend_glow_colors(owner_id);

alter table public.friend_glow_colors enable row level security;

-- An owner may read their own colour choices directly (the renderer loads them
-- server-side with the service role, but a direct client read stays scoped to
-- the owner). Writes go through the server action under the service role after
-- the entitlement + friendship checks, so no insert/update/delete grant is
-- given to anon or authenticated.
drop policy if exists "own glow colours readable" on public.friend_glow_colors;
create policy "own glow colours readable" on public.friend_glow_colors
  for select using (auth.uid() = owner_id);

revoke insert, update, delete on table public.friend_glow_colors from anon, authenticated;
