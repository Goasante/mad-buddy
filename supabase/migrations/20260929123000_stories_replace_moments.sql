-- Stories replace the paused Moments product without duplicating the proven
-- temporary-media storage model. Historical Moment rows remain identifiable;
-- new Story rows are explicitly tagged and governed by stricter privacy rules.

alter table public.moments
  add column if not exists surface text not null default 'moment';

alter table public.moments
  drop constraint if exists moments_surface_check;

alter table public.moments
  add constraint moments_surface_check
  check (surface in ('moment', 'story'));

create index if not exists moments_story_active_author_idx
  on public.moments(author_id, expires_at, created_at)
  where surface = 'story' and status = 'active';

-- Product cutover: legacy Moments stop being live. Their relational history
-- remains for audit/analytics, but non-legal-hold media can be reclaimed by
-- the existing deletion worker.
update public.moments
set status = 'expired',
    updated_at = now()
where surface = 'moment'
  and status = 'active';

insert into public.media_deletion_queue(media_asset_id, reason)
select distinct m.media_id, 'parent_expired'
from public.moments m
join public.media_assets a on a.id = m.media_id
where m.surface = 'moment'
  and m.media_id is not null
  and a.deleted_at is null
  and a.retention_policy <> 'legal_hold'
on conflict (media_asset_id) do nothing;

-- Browser clients must not be able to use the old author policy to create or
-- mutate Story rows directly. Story writes go through server-only RPC/actions.
drop policy if exists "stories server managed inserts" on public.moments;
create policy "stories server managed inserts"
on public.moments
as restrictive
for insert
to authenticated
with check (false);

drop policy if exists "stories server managed updates" on public.moments;
create policy "stories server managed updates"
on public.moments
as restrictive
for update
to authenticated
using (false)
with check (false);

drop policy if exists "stories server managed deletes" on public.moments;
create policy "stories server managed deletes"
on public.moments
as restrictive
for delete
to authenticated
using (false);

-- Story reads are server-authorised. Browser/native clients may read their
-- own Story rows, but another person's Story metadata is never exposed through
-- the Data API. The server service re-checks friendship, blocks and the exact
-- Story audience before it returns anything or mints a signed media URL.
drop policy if exists "story audience privacy" on public.moments;
create policy "story audience privacy"
on public.moments
as restrictive
for select
to authenticated
using (
  surface <> 'story'
  or author_id = (select auth.uid())
);

-- Five ACTIVE Stories per creator, transactionally enforced. The advisory lock
-- serialises concurrent taps/devices for one creator so two requests cannot
-- both observe four active Stories and create a sixth.
create or replace function public.create_story(
  p_actor_id uuid,
  p_media_id uuid,
  p_caption text,
  p_audience_type text,
  p_target_ids uuid[] default array[]::uuid[]
)
returns table (
  story_id uuid,
  story_expires_at timestamptz,
  active_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_story_id uuid;
  v_expires_at timestamptz;
  v_active_count integer;
  v_targets uuid[] := coalesce(p_target_ids, array[]::uuid[]);
begin
  if p_actor_id is null or p_media_id is null then
    raise exception using errcode = 'P0001', message = 'story_invalid_input';
  end if;

  if p_audience_type not in ('all_muddies', 'close_friends', 'selected_muddies') then
    raise exception using errcode = 'P0001', message = 'story_invalid_audience';
  end if;

  if p_audience_type = 'selected_muddies' and cardinality(v_targets) = 0 then
    raise exception using errcode = 'P0001', message = 'story_empty_audience';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('story:' || p_actor_id::text, 0));

  select count(*)::integer
  into v_active_count
  from public.moments m
  where m.author_id = p_actor_id
    and m.surface = 'story'
    and m.status = 'active'
    and m.expires_at > now();

  if v_active_count >= 5 then
    raise exception using errcode = 'P0001', message = 'story_active_limit';
  end if;

  if not exists (
    select 1
    from public.media_assets a
    where a.id = p_media_id
      and a.owner_id = p_actor_id
      and a.context_type = 'moment'
      and a.processing_status = 'ready'
      and a.moderation_status in ('active', 'restored')
      and a.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'story_media_unavailable';
  end if;

  if p_audience_type = 'selected_muddies' and exists (
    select 1
    from unnest(v_targets) as target(target_id)
    where target.target_id = p_actor_id
       or not exists (
         select 1
         from public.friendships f
         where f.ended_at is null
           and (
             (f.user_one_id = p_actor_id and f.user_two_id = target.target_id)
             or
             (f.user_two_id = p_actor_id and f.user_one_id = target.target_id)
           )
       )
       or exists (
         select 1
         from public.blocked_users b
         where
           (b.blocker_id = p_actor_id and b.blocked_id = target.target_id)
           or
           (b.blocker_id = target.target_id and b.blocked_id = p_actor_id)
       )
  ) then
    raise exception using errcode = 'P0001', message = 'story_invalid_targets';
  end if;

  v_story_id := gen_random_uuid();
  v_expires_at := now() + interval '12 hours';

  insert into public.moments (
    id,
    author_id,
    content_type,
    media_id,
    caption,
    audience_type,
    status,
    starts_at,
    expires_at,
    surface
  )
  values (
    v_story_id,
    p_actor_id,
    'photo',
    p_media_id,
    nullif(btrim(p_caption), ''),
    p_audience_type,
    'active',
    now(),
    v_expires_at,
    'story'
  );

  if p_audience_type = 'selected_muddies' then
    insert into public.moment_audience_targets(moment_id, target_type, target_id)
    select v_story_id, 'user', target_id
    from (
      select distinct unnest(v_targets) as target_id
    ) targets;
  end if;

  update public.media_assets
  set upload_expires_at = null,
      updated_at = now()
  where id = p_media_id
    and owner_id = p_actor_id;

  return query
  select v_story_id, v_expires_at, v_active_count + 1;
end;
$$;

revoke all on function public.create_story(uuid, uuid, text, text, uuid[])
from public, anon, authenticated;
grant execute on function public.create_story(uuid, uuid, text, text, uuid[])
to service_role;

-- A Story upload is sent only when Share is tapped, but a serverless process can
-- still die between storing the image and attaching it to the Story. This sweep
-- makes that rare case self-cleaning instead of permanent storage.
create or replace function public.queue_stale_unattached_story_media(
  p_before timestamptz,
  p_limit integer default 100
)
returns integer
language sql
security invoker
set search_path = public, pg_temp
as $$
  with candidates as (
    select a.id
    from public.media_assets a
    where a.context_type = 'moment'
      and a.upload_expires_at is not null
      and a.upload_expires_at < p_before
      and a.deleted_at is null
      and not exists (
        select 1
        from public.moments m
        where m.media_id = a.id
      )
    order by a.upload_expires_at asc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ),
  queued as (
    insert into public.media_deletion_queue(media_asset_id, reason)
    select id, 'orphaned_upload'
    from candidates
    on conflict (media_asset_id) do nothing
    returning 1
  )
  select count(*)::integer
  from queued;
$$;

revoke all on function public.queue_stale_unattached_story_media(timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.queue_stale_unattached_story_media(timestamptz, integer)
to service_role;
