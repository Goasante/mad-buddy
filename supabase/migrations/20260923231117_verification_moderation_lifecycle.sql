-- Complete the user -> review -> decision lifecycle for identity verification,
-- and connect reviewed reports to transparent, appealable account enforcement.

-- ---------------------------------------------------------------------------
-- Identity verification applications and private evidence metadata.
-- ---------------------------------------------------------------------------

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  document_type text not null check (document_type in ('passport', 'national_id', 'drivers_licence', 'voter_id')),
  country_code text not null default 'GH' check (country_code ~ '^[A-Z]{2}$'),
  status text not null default 'draft' check (
    status in ('draft', 'pending', 'under_review', 'more_information_required', 'verified', 'declined', 'revoked', 'cancelled')
  ),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  user_message text check (char_length(user_message) <= 1000),
  internal_note text check (char_length(internal_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index verification_requests_one_active_per_user
  on public.verification_requests(user_id)
  where status in ('draft', 'pending', 'under_review', 'more_information_required');
create index verification_requests_queue_idx
  on public.verification_requests(status, submitted_at nulls last, created_at);

create table public.verification_evidence (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.verification_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  evidence_kind text not null check (evidence_kind in ('document_front', 'document_back', 'selfie')),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  original_file_name text check (char_length(original_file_name) <= 180),
  validated_at timestamptz,
  retention_expires_at timestamptz not null default (now() + interval '90 days'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verification_evidence_one_kind unique (request_id, evidence_kind)
);

create index verification_evidence_retention_idx
  on public.verification_evidence(retention_expires_at)
  where deleted_at is null;

alter table public.verification_requests enable row level security;
alter table public.verification_evidence enable row level security;

-- User reads and every write go through narrow server actions. This prevents
-- internal reviewer notes and evidence storage paths from becoming reachable
-- through a broad table SELECT even when the row belongs to the caller.
drop policy if exists "verification requests visible to owner" on public.verification_requests;
drop policy if exists "verification evidence metadata visible to owner" on public.verification_evidence;
revoke all on public.verification_requests, public.verification_evidence from anon, authenticated;
grant select, insert, update, delete on public.verification_requests, public.verification_evidence to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-evidence',
  'verification-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No browser role gets direct object access. Upload uses a short-lived signed
-- intent and staff downloads use a separately audited short-lived signed URL.
drop policy if exists "verification evidence owner select" on storage.objects;
drop policy if exists "verification evidence owner insert" on storage.objects;
drop policy if exists "verification evidence owner update" on storage.objects;
drop policy if exists "verification evidence owner delete" on storage.objects;

-- ---------------------------------------------------------------------------
-- Confirmed moderation strikes. Raw reports never create a strike.
-- ---------------------------------------------------------------------------

create table public.moderation_strikes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_kind text not null check (report_kind in ('user', 'content')),
  report_id uuid not null,
  action_type text not null,
  points smallint not null check (points between 1 and 10),
  reason_code text not null check (char_length(reason_code) between 1 and 120),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '180 days'),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint moderation_strikes_one_per_report unique (report_kind, report_id)
);

create index moderation_strikes_user_active_idx
  on public.moderation_strikes(user_id, expires_at desc)
  where reversed_at is null;

alter table public.moderation_strikes enable row level security;
-- Staff-only. Affected users see the resulting restriction and appeal state,
-- not internal risk scoring or reporter information.
revoke all on public.moderation_strikes from anon, authenticated;
grant select, insert, update, delete on public.moderation_strikes to service_role;

-- Appeals are submitted through the server action, which checks that the
-- referenced restriction belongs to the caller. Direct browser writes stay
-- closed so a crafted row cannot point at somebody else's restriction.
drop policy if exists "appeals insert by subject" on public.appeals;

create unique index if not exists appeals_one_per_restriction
  on public.appeals(subject_user_id, source_restriction_id)
  where source_restriction_id is not null;

revoke select, insert, update, delete on public.appeals from anon, authenticated;

-- The account-status screen is server-rendered through the service role so it
-- can expose only safe fields. Keep direct browser access closed.
revoke select, insert, update, delete on public.user_restrictions from anon, authenticated;
