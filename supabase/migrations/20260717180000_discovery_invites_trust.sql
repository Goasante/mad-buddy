-- Friend Discovery, Invite Links, QR Invites, Contact Matching, Account Trust
-- (feature architecture batch 8). Additive: new tables plus new nullable /
-- defaulted columns on the existing friend_requests and friendships tables.
-- Nothing is dropped, no constraint is narrowed, and every existing row stays
-- valid — current queries that ignore the new columns keep working unchanged.
--
-- Reuse notes (deliberately NOT recreated):
--   * friend_requests and friendships already exist. The spec's
--     `recipient_id` is this schema's existing `receiver_id`; we keep the
--     existing name rather than churn every caller.
--   * blocked_users remains the block source of truth.
--
-- Privacy note: contact matching never stores a raw phone number or email.
-- Only a peppered HMAC ("protected identifier") is stored, and only for users
-- who explicitly opted in. Uploaded match payloads are not persisted at all.
--
-- Rollback: drop the new tables; the added columns are harmless if left.
--   drop table if exists public.account_trust_events, public.account_verifications,
--     public.contact_match_sessions, public.discoverability_identifiers,
--     public.qr_sessions, public.invite_links cascade;

-- ---------------------------------------------------------------------------
-- Extend friend requests + friendships (spec §14).
-- ---------------------------------------------------------------------------

alter table public.friend_requests
  add column if not exists context_type text,
  add column if not exists context_id uuid,
  add column if not exists message text,
  add column if not exists responded_at timestamptz,
  -- Requests expire so a stale ask doesn't linger forever (spec §10).
  add column if not exists expires_at timestamptz;

-- Added as a separate statement so the check only covers the new column and
-- tolerates existing NULLs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'friend_requests_context_type_check'
  ) then
    alter table public.friend_requests add constraint friend_requests_context_type_check
      check (context_type is null or context_type in ('school', 'work', 'church', 'event', 'friend', 'other'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'friend_requests_message_length_check'
  ) then
    alter table public.friend_requests add constraint friend_requests_message_length_check
      check (message is null or char_length(message) <= 200);
  end if;
end$$;

create index if not exists friend_requests_expiry_idx on public.friend_requests(status, expires_at);

-- At most one PENDING request per direction (spec §16: no duplicate requests).
-- Partial, so historical accepted/declined rows are untouched and a pair can
-- legitimately request again after a decline. This is the database backstop for
-- the application-level duplicate check — it makes the concurrent-double-send
-- race impossible rather than merely unlikely.
create unique index if not exists friend_requests_one_pending_per_direction
  on public.friend_requests(sender_id, receiver_id)
  where status = 'pending';

alter table public.friendships
  add column if not exists accepted_request_id uuid references public.friend_requests(id) on delete set null,
  add column if not exists ended_at timestamptz;

-- ---------------------------------------------------------------------------
-- FEATURE 2/3: Invite links + QR sessions (spec §26, §36).
-- ---------------------------------------------------------------------------

create table if not exists public.invite_links (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  invite_type text not null check (invite_type in ('personal', 'event', 'circle', 'community')),
  context_id uuid,
  -- Only a SHA-256 hash of the token is stored, never the raw token (§26).
  token_hash text not null unique,
  delivery_type text not null default 'link' check (delivery_type in ('link', 'qr')),
  status text not null default 'active' check (status in ('active', 'used', 'revoked', 'expired')),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rotating personal-QR windows (spec §33). Optional audit of consumed windows.
create table if not exists public.qr_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invite_links_creator_idx on public.invite_links(creator_id, status);
create index if not exists invite_links_expiry_idx on public.invite_links(status, expires_at);
create index if not exists qr_sessions_user_idx on public.qr_sessions(user_id, expires_at);

alter table public.invite_links enable row level security;
alter table public.qr_sessions enable row level security;

-- Only the creator manages their invites. Resolution happens server-side via
-- the service role: a token holder is not (yet) an authenticated owner, so
-- there is deliberately no public read policy here.
create policy "invite links creator access" on public.invite_links
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "qr sessions owner access" on public.qr_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 4: Contact matching (spec §41, §46).
-- ---------------------------------------------------------------------------

create table if not exists public.discoverability_identifiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('phone', 'email')),
  -- Peppered HMAC of the normalized identifier. Never the raw value (§41).
  protected_identifier text not null,
  -- Off until the user consents (spec §5 defaults).
  is_discoverable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discoverability_identifiers_unique unique (user_id, identifier_type)
);

-- Lookup index for matching. Only rows with is_discoverable = true are ever
-- consulted, enforced in the application layer.
create index if not exists discoverability_lookup_idx
  on public.discoverability_identifiers(identifier_type, protected_identifier)
  where is_discoverable = true;

-- Session metadata only — uploaded contact hashes are matched in-request and
-- never persisted (spec §41: delete temporary matching payloads promptly).
create table if not exists public.contact_match_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed', 'deleted')),
  submitted_count integer not null default 0,
  matched_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz
);

create index if not exists contact_match_sessions_user_idx on public.contact_match_sessions(user_id, created_at desc);

alter table public.discoverability_identifiers enable row level security;
alter table public.contact_match_sessions enable row level security;

-- A user controls only their own identifiers. Nobody can read another user's
-- protected identifier — matching happens exclusively via the service role.
create policy "discoverability owner access" on public.discoverability_identifiers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "contact match sessions owner access" on public.contact_match_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 5: Account trust (spec §60).
-- ---------------------------------------------------------------------------

create table if not exists public.account_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  verification_type text not null check (
    verification_type in ('email', 'phone', 'institution', 'organisation')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'verified', 'failed', 'expired', 'revoked')
  ),
  provider text,
  -- Minimal evidence only: e.g. an institution domain. Never an ID document.
  evidence_label text check (char_length(evidence_label) <= 120),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_verifications_unique unique (user_id, verification_type)
);

-- Internal abuse signals. Never exposed to end users (spec §57).
create table if not exists public.account_trust_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'request_declined', 'blocked_by_user', 'report_received', 'invite_abuse',
      'duplicate_content', 'rapid_requests', 'impersonation_report'
    )
  ),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

create index if not exists account_verifications_user_idx on public.account_verifications(user_id, status);
create index if not exists account_trust_events_user_idx on public.account_trust_events(user_id, created_at desc);

alter table public.account_verifications enable row level security;
alter table public.account_trust_events enable row level security;

-- A user may read their own verification status. The public trust summary for
-- OTHER users is assembled server-side from safe signals only (spec §61).
create policy "verifications owner read" on public.account_verifications
  for select using (auth.uid() = user_id);

-- account_trust_events is staff-only: no policy grants any end user access,
-- so internal risk signals can never leak (spec §57).
