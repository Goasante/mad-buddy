-- Optional phone identity, for contact discovery.
--
-- Additive only. No existing column changes, no existing row changes, and no
-- existing account becomes discoverable as a result of this migration.
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON profiles:
--
--   The profiles SELECT policy is ROW level, not column level:
--
--     "friends can view limited profiles"
--       using (is_friend(user_id) and not is_blocked_between(user_id) ...)
--
--   Postgres RLS grants or denies the whole ROW. A phone column on profiles
--   would therefore be readable by every Muddy the moment it existed -- the
--   application could select around it, but any direct PostgREST read with a
--   user's own token would return it. Splitting the number into its own table
--   with an owner-only policy means the database itself refuses, rather than
--   relying on every future query remembering not to ask for the column.
--
-- WHY phone_verified_at EXISTS BUT IS ALWAYS NULL:
--
--   There is no SMS or WhatsApp verification yet, so no number here is proven
--   to belong to its claimant. The column is created now so that adding OTP
--   later is a matter of writing a timestamp rather than a schema change plus
--   a backfill -- but nothing may set it until real verification exists, and
--   nothing may present an unverified number as verified.
--
-- Rollback:
--   drop table if exists public.user_phone_identities;

create table if not exists public.user_phone_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- E.164, normalised SERVER-SIDE. Never a client-supplied string taken on
  -- trust: the server re-normalises whatever it is given.
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9]\d{6,14}$'),

  -- The region used to interpret a number typed without a country code. Kept
  -- for diagnostics and for re-normalising if a parsing rule ever changes.
  phone_region text check (phone_region ~ '^[A-Z]{2}$'),

  -- NULL until real verification exists. See the note above: this is a
  -- placeholder for a future OTP flow, not a claim about the current number.
  phone_verified_at timestamptz,

  -- THE MATCHING IDENTIFIER: an HMAC of phone_e164 under a server-only key.
  --
  -- Matching compares these rather than numbers, so the query never carries a
  -- phone number and a caller never receives one. An unsalted hash would be
  -- pointless here -- a nine-digit national number is a search space a laptop
  -- exhausts in minutes -- so the key is what makes the column inert to anyone
  -- who obtains it.
  --
  -- Nullable because the row is written before the identifier when matching is
  -- not yet configured; a row without one simply never matches.
  match_hmac text check (match_hmac ~ '^[0-9a-f]{64}$'),

  -- Which key produced match_hmac. Rotation writes a new version alongside the
  -- old rather than invalidating every existing identifier at once, and this
  -- is what a recompute job would filter on.
  match_key_version smallint not null default 1,

  -- OFF by default, and deliberately so. An existing user who adds a number
  -- for a future purpose must not silently become findable by everyone who
  -- has them saved; discovery is a second, separate decision.
  contact_discovery_enabled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ONE ACCOUNT PER NUMBER, enforced by the database.
--
-- Without verification, a number is a claim rather than a proof. A partial
-- unique index means the SECOND account claiming a number is rejected outright
-- instead of silently taking over discoverability from the first -- which is
-- exactly how an attacker would hijack somebody else's contact matches.
--
-- Partial on the discovery flag: a number that is not being used for discovery
-- constrains nothing, so someone who genuinely changed numbers is not blocked
-- by a dormant claim on a disabled account.
create unique index if not exists user_phone_identities_active_phone_idx
  on public.user_phone_identities (phone_e164)
  where contact_discovery_enabled;

-- THE MATCHING LOOKUP.
--
-- On the HMAC rather than the number, because that is what the query carries.
-- Partial on the discovery flag so rows that cannot produce a match are not in
-- the index at all -- which also means a disabled account costs nothing to
-- skip rather than being filtered after the fact.
create index if not exists user_phone_identities_match_idx
  on public.user_phone_identities (match_hmac, match_key_version)
  where contact_discovery_enabled and match_hmac is not null;

alter table public.user_phone_identities enable row level security;

-- OWNER ONLY, in both directions.
--
-- Nobody may read another person's number -- not a friend, not a Muddy, not
-- anyone. Contact matching never reads this table as the viewer; it runs
-- server-side under the service role, compares hashed identifiers, and returns
-- profiles rather than numbers. A viewer receiving a match learns that someone
-- they already have saved is on Mad Buddy, never any number from this table.
create policy "phone identity owner reads"
  on public.user_phone_identities
  for select
  using (auth.uid() = user_id);

-- A person may set and change their own number and their own discovery flag.
--
-- WITH CHECK pins the DESTINATION row, so an update cannot move a phone
-- identity onto another account.
create policy "phone identity owner writes"
  on public.user_phone_identities
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Verification state is SERVER-ONLY, and this is what enforces it.
--
-- The owner policy above would otherwise let a client write its own
-- phone_verified_at and present itself as verified. The trigger rejects any
-- non-null value that did not come from the service role, so "verified" can
-- only ever be set by code holding the service key -- which is where a real
-- OTP flow will live.
create or replace function public.reject_client_phone_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone_verified_at is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'phone_verified_at is set by verification only';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_phone_identities_guard
  before insert or update on public.user_phone_identities
  for each row execute function public.reject_client_phone_verification();

comment on table public.user_phone_identities is
  'Optional phone identity for contact discovery. Owner-only under RLS: a number is matching material, never profile content, and is never returned to another user. Separate from profiles because that table''s SELECT policy is row level, so a column there would be readable by every Muddy.';

comment on column public.user_phone_identities.phone_verified_at is
  'NULL until real SMS/WhatsApp verification exists. Writable only by the service role (see trigger). An unverified number is a claim, not proof of ownership.';

comment on column public.user_phone_identities.match_hmac is
  'HMAC-SHA256 of phone_e164 under a server-only key. Matching compares these, so no query carries a phone number and no caller receives one. An unsalted hash would be reversible: a national mobile number is a small enough search space to exhaust offline.';

comment on column public.user_phone_identities.match_key_version is
  'Which HMAC key produced match_hmac. Lets a rotated key coexist with existing identifiers instead of invalidating every match at once.';

comment on column public.user_phone_identities.contact_discovery_enabled is
  'OFF by default. Adding a number and being findable are two separate decisions; migration never makes an existing account discoverable.';
