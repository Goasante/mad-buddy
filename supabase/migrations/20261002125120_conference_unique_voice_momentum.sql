-- Conference Hot ranking balance:
-- Distinct people joining a Topic matter more than repeated replies from the
-- same person. Keep this aggregate exact at write time so feed reads stay cheap.

alter table public.conference_topics
  add column if not exists unique_voice_count integer not null default 0
  check (unique_voice_count >= 0);

update public.conference_topics t
set unique_voice_count = coalesce((
  select count(distinct r.author_user_id)::integer
  from public.conference_replies r
  where r.topic_id = t.id
    and r.status = 'active'
), 0);

create or replace function public.conference_adjust_reply_count()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.topic_id is not distinct from new.topic_id
     and old.author_user_id is not distinct from new.author_user_id then
    return new;
  end if;

  if tg_op in ('DELETE', 'UPDATE') and old.status = 'active' then
    update public.conference_topics
    set
      reply_count = greatest(0, reply_count - 1),
      unique_voice_count = greatest(
        0,
        unique_voice_count -
          case
            when not exists (
              select 1
              from public.conference_replies r
              where r.topic_id = old.topic_id
                and r.author_user_id = old.author_user_id
                and r.status = 'active'
                and r.id <> old.id
            ) then 1
            else 0
          end
      )
    where id = old.topic_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.status = 'active' then
    update public.conference_topics
    set
      reply_count = reply_count + 1,
      unique_voice_count = unique_voice_count +
        case
          when not exists (
            select 1
            from public.conference_replies r
            where r.topic_id = new.topic_id
              and r.author_user_id = new.author_user_id
              and r.status = 'active'
              and r.id <> new.id
          ) then 1
          else 0
        end
    where id = new.topic_id;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.conference_adjust_reply_count() from public, anon, authenticated;
