-- Conference activity architecture:
-- - expires_at becomes a rolling inactivity deadline.
-- - a new Voice or positive Hype reheats the Topic.
-- - Pass affects discovery/ranking in application code but never extends life.
-- - Voice-to-Voice replies remain a flat stream with optional quoted context.

alter table public.conference_topics
  add column if not exists last_activity_at timestamptz;

update public.conference_topics t
set last_activity_at = greatest(
  t.created_at,
  coalesce((
    select max(r.created_at)
    from public.conference_replies r
    where r.topic_id = t.id
      and r.status = 'active'
  ), t.created_at),
  coalesce((
    select max(v.updated_at)
    from public.conference_votes v
    left join public.conference_replies vr on vr.id = v.reply_id
    where v.value = 1
      and (v.topic_id = t.id or vr.topic_id = t.id)
  ), t.created_at)
)
where t.last_activity_at is null;

alter table public.conference_topics
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

update public.conference_topics
set expires_at = last_activity_at + interval '7 days'
where status = 'active';

alter table public.conference_replies
  add column if not exists reply_to_reply_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conference_replies_reply_to_reply_id_fkey'
      and conrelid = 'public.conference_replies'::regclass
  ) then
    alter table public.conference_replies
      add constraint conference_replies_reply_to_reply_id_fkey
      foreign key (reply_to_reply_id)
      references public.conference_replies(id)
      on delete set null;
  end if;
end $$;

create index if not exists conference_topics_active_activity_idx
  on public.conference_topics(last_activity_at desc, created_at desc)
  where status = 'active';

create index if not exists conference_replies_reply_to_idx
  on public.conference_replies(reply_to_reply_id)
  where reply_to_reply_id is not null;

create or replace function public.conference_validate_reply_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_topic uuid;
  parent_status text;
begin
  if new.reply_to_reply_id is null then
    return new;
  end if;

  if new.reply_to_reply_id = new.id then
    raise exception 'conference_reply_cannot_reply_to_self';
  end if;

  select r.topic_id, r.status
    into parent_topic, parent_status
  from public.conference_replies r
  where r.id = new.reply_to_reply_id;

  if parent_topic is null
     or parent_topic <> new.topic_id
     or parent_status <> 'active' then
    raise exception 'conference_reply_parent_unavailable';
  end if;

  return new;
end;
$$;

drop trigger if exists conference_reply_parent_guard on public.conference_replies;
create trigger conference_reply_parent_guard
before insert or update of reply_to_reply_id, topic_id
on public.conference_replies
for each row
execute function public.conference_validate_reply_parent();

create or replace function public.conference_adjust_reply_count()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.topic_id is not distinct from new.topic_id then
    return new;
  end if;

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

create or replace function public.conference_touch_reply_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' then
    update public.conference_topics
    set
      last_activity_at = greatest(last_activity_at, new.created_at),
      expires_at = greatest(expires_at, new.created_at + interval '7 days')
    where id = new.topic_id
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists conference_reply_activity on public.conference_replies;
create trigger conference_reply_activity
after insert
on public.conference_replies
for each row
execute function public.conference_touch_reply_activity();

create or replace function public.conference_touch_hype_activity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_topic uuid;
begin
  -- A Pass affects score but does not keep a Topic alive. Removing a Hype also
  -- does not count as fresh positive activity.
  if new.value <> 1 or (tg_op = 'UPDATE' and old.value = 1) then
    return new;
  end if;

  if new.topic_id is not null then
    target_topic := new.topic_id;
  elsif new.reply_id is not null then
    select r.topic_id into target_topic
    from public.conference_replies r
    where r.id = new.reply_id
      and r.status = 'active';
  end if;

  if target_topic is not null then
    update public.conference_topics
    set
      last_activity_at = greatest(last_activity_at, now()),
      expires_at = greatest(expires_at, now() + interval '7 days')
    where id = target_topic
      and status = 'active';
  end if;

  return new;
end;
$$;

drop trigger if exists conference_hype_activity on public.conference_votes;
create trigger conference_hype_activity
after insert or update of value
on public.conference_votes
for each row
execute function public.conference_touch_hype_activity();

revoke all on function public.conference_validate_reply_parent() from public, anon, authenticated;
revoke all on function public.conference_touch_reply_activity() from public, anon, authenticated;
revoke all on function public.conference_touch_hype_activity() from public, anon, authenticated;
