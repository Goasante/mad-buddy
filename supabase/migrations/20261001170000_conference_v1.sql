-- Conference V1: lightweight hyperlocal anonymous conversations.
--
-- Privacy boundary:
--   * Conference does NOT write public.user_locations and therefore cannot
--     refresh or change Glow presence as a side effect.
--   * conference_locations is one overwrite-only, current coarse signal per
--     user. It is not a history table and is never exposed to browser roles.
--   * Topic anchors are snapped before storage and never projected to clients.
--
-- Authority boundary:
--   * all Conference product reads/writes go through trusted server code;
--   * anon/authenticated get no direct table privileges;
--   * service_role grants are explicit so this remains compatible with
--     Supabase's 2026 Data API default-grant changes.

create table if not exists public.conference_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy double precision not null check (accuracy between 0 and 10000),
  last_updated timestamptz not null default now()
);

comment on table public.conference_locations is
  'Current coarse Conference location only. One row per user, overwritten on refresh; separate from Glow/user_locations.';

create table if not exists public.conference_topics (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users(id) on delete cascade,
  -- Privacy-preserving coarse anchor used only for the server-side 15 km check.
  origin_latitude double precision not null check (origin_latitude between -90 and 90),
  origin_longitude double precision not null check (origin_longitude between -180 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  status text not null default 'active' check (status in ('active','hidden','removed')),
  hype_count integer not null default 0 check (hype_count >= 0),
  pass_count integer not null default 0 check (pass_count >= 0),
  reply_count integer not null default 0 check (reply_count >= 0),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists conference_topics_geo_created_idx
  on public.conference_topics (origin_latitude, origin_longitude, created_at desc);
create index if not exists conference_topics_active_feed_idx
  on public.conference_topics (status, expires_at, created_at desc);
create index if not exists conference_topics_author_created_idx
  on public.conference_topics (author_user_id, created_at desc);

create table if not exists public.conference_replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.conference_topics(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  status text not null default 'active' check (status in ('active','hidden','removed')),
  hype_count integer not null default 0 check (hype_count >= 0),
  pass_count integer not null default 0 check (pass_count >= 0),
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

create index if not exists conference_voice_ids_user_idx
  on public.conference_voice_ids (user_id);

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
create index if not exists conference_votes_user_idx
  on public.conference_votes (user_id);

create table if not exists public.conference_hidden_users (
  viewer_user_id uuid not null references auth.users(id) on delete cascade,
  hidden_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (viewer_user_id, hidden_user_id),
  check (viewer_user_id <> hidden_user_id)
);

create index if not exists conference_hidden_users_hidden_idx
  on public.conference_hidden_users (hidden_user_id);

-- Keep Hype/Pass and visible Voice counts cheap and exact under concurrency.
create or replace function public.conference_adjust_vote_counts()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    if old.topic_id is not null then
      update public.conference_topics
      set
        hype_count = greatest(0, hype_count - case when old.value = 1 then 1 else 0 end),
        pass_count = greatest(0, pass_count - case when old.value = -1 then 1 else 0 end)
      where id = old.topic_id;
    elsif old.reply_id is not null then
      update public.conference_replies
      set
        hype_count = greatest(0, hype_count - case when old.value = 1 then 1 else 0 end),
        pass_count = greatest(0, pass_count - case when old.value = -1 then 1 else 0 end)
      where id = old.reply_id;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.topic_id is not null then
      update public.conference_topics
      set
        hype_count = hype_count + case when new.value = 1 then 1 else 0 end,
        pass_count = pass_count + case when new.value = -1 then 1 else 0 end
      where id = new.topic_id;
    elsif new.reply_id is not null then
      update public.conference_replies
      set
        hype_count = hype_count + case when new.value = 1 then 1 else 0 end,
        pass_count = pass_count + case when new.value = -1 then 1 else 0 end
      where id = new.reply_id;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists conference_vote_counts on public.conference_votes;
create trigger conference_vote_counts
  after insert or update or delete on public.conference_votes
  for each row execute function public.conference_adjust_vote_counts();

create or replace function public.conference_adjust_reply_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.status = 'active' then
    update public.conference_topics
    set reply_count = greatest(0, reply_count - 1)
    where id = old.topic_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
    update public.conference_topics
    set reply_count = reply_count + 1
    where id = new.topic_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists conference_reply_counts on public.conference_replies;
create trigger conference_reply_counts
  after insert or update of status, topic_id or delete on public.conference_replies
  for each row execute function public.conference_adjust_reply_count();

-- Conference reports belong to Mad Buddy's existing Trust & Safety queue.
alter table public.content_reports
  drop constraint if exists content_reports_content_type_check;
alter table public.content_reports
  add constraint content_reports_content_type_check
  check (
    content_type = any (
      array[
        'moment'::text,
        'drop'::text,
        'message'::text,
        'profile'::text,
        'announcement'::text,
        'plan'::text,
        'conference_topic'::text,
        'conference_reply'::text
      ]
    )
  );

create index if not exists content_reports_target_idx
  on public.content_reports (content_type, content_id, created_at desc);

alter table public.conference_locations enable row level security;
alter table public.conference_topics enable row level security;
alter table public.conference_replies enable row level security;
alter table public.conference_voice_ids enable row level security;
alter table public.conference_votes enable row level security;
alter table public.conference_hidden_users enable row level security;

revoke all on table
  public.conference_locations,
  public.conference_topics,
  public.conference_replies,
  public.conference_voice_ids,
  public.conference_votes,
  public.conference_hidden_users
from anon, authenticated;

grant select, insert, update, delete on table
  public.conference_locations,
  public.conference_topics,
  public.conference_replies,
  public.conference_voice_ids,
  public.conference_votes,
  public.conference_hidden_users
to service_role;

revoke execute on function public.conference_adjust_vote_counts() from public, anon, authenticated;
revoke execute on function public.conference_adjust_reply_count() from public, anon, authenticated;
grant execute on function public.conference_adjust_vote_counts() to service_role;
grant execute on function public.conference_adjust_reply_count() to service_role;

comment on table public.conference_topics is
  'Conference Topics. Coarse origin anchor is server-only and used only for 15 km Around You discovery.';
comment on table public.conference_voice_ids is
  'Per-topic anonymous identity mapping. Never expose user_id to Conference clients.';
