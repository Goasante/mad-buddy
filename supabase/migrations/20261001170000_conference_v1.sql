-- Conference V1: lightweight hyperlocal anonymous conversations.
-- All product reads/writes go through trusted server code. Client-side direct
-- table access is intentionally disabled by RLS-without-policies.

create table if not exists public.conference_topics (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users(id) on delete cascade,
  -- Private, coarse anchor used only for the 15km server-side radius check.
  -- Never project these coordinates to clients.
  origin_latitude double precision not null check (origin_latitude between -90 and 90),
  origin_longitude double precision not null check (origin_longitude between -180 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  status text not null default 'active' check (status in ('active','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conference_topics_geo_created_idx
  on public.conference_topics (origin_latitude, origin_longitude, created_at desc);
create index if not exists conference_topics_status_created_idx
  on public.conference_topics (status, created_at desc);
create index if not exists conference_topics_author_created_idx
  on public.conference_topics (author_user_id, created_at desc);

create table if not exists public.conference_replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.conference_topics(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  status text not null default 'active' check (status in ('active','hidden','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conference_replies_topic_created_idx
  on public.conference_replies (topic_id, created_at asc);
create index if not exists conference_replies_author_created_idx
  on public.conference_replies (author_user_id, created_at desc);

create table if not exists public.conference_voice_ids (
  topic_id uuid not null references public.conference_topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_number integer not null check (voice_number between 1 and 999),
  created_at timestamptz not null default now(),
  primary key (topic_id, user_id),
  unique (topic_id, voice_number)
);

create table if not exists public.conference_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references public.conference_topics(id) on delete cascade,
  reply_id uuid references public.conference_replies(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((topic_id is not null)::integer + (reply_id is not null)::integer = 1)
);

create unique index if not exists conference_votes_topic_user_unique
  on public.conference_votes (topic_id, user_id) where topic_id is not null;
create unique index if not exists conference_votes_reply_user_unique
  on public.conference_votes (reply_id, user_id) where reply_id is not null;
create index if not exists conference_votes_topic_idx
  on public.conference_votes (topic_id) where topic_id is not null;
create index if not exists conference_votes_reply_idx
  on public.conference_votes (reply_id) where reply_id is not null;

create table if not exists public.conference_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references public.conference_topics(id) on delete cascade,
  reply_id uuid references public.conference_replies(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','hate','false_info','other')),
  created_at timestamptz not null default now(),
  check ((topic_id is not null)::integer + (reply_id is not null)::integer = 1)
);

create unique index if not exists conference_reports_topic_user_unique
  on public.conference_reports (topic_id, reporter_user_id) where topic_id is not null;
create unique index if not exists conference_reports_reply_user_unique
  on public.conference_reports (reply_id, reporter_user_id) where reply_id is not null;

create table if not exists public.conference_hidden_users (
  viewer_user_id uuid not null references auth.users(id) on delete cascade,
  hidden_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_user_id, hidden_user_id),
  check (viewer_user_id <> hidden_user_id)
);

create table if not exists public.conference_restrictions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  can_post boolean not null default true,
  can_reply boolean not null default true,
  can_vote boolean not null default true,
  can_report boolean not null default true,
  reason text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.conference_topics enable row level security;
alter table public.conference_replies enable row level security;
alter table public.conference_voice_ids enable row level security;
alter table public.conference_votes enable row level security;
alter table public.conference_reports enable row level security;
alter table public.conference_hidden_users enable row level security;
alter table public.conference_restrictions enable row level security;

comment on table public.conference_topics is
  'Conference topics. origin coordinates are private coarse anchors for server-side 15km discovery only.';
comment on table public.conference_voice_ids is
  'Per-topic anonymous identity mapping. Never expose user_id to Conference clients.';
