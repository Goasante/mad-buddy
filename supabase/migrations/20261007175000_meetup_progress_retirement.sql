-- Meetups are now the canonical real-world coordination product.
-- Keep the existing stable score/achievement codes readable, but move current
-- earning and presentation to confirmed Meetup activity.

alter table public.buddy_score_ledger
  drop constraint if exists buddy_score_ledger_event_type_check;

alter table public.buddy_score_ledger
  add constraint buddy_score_ledger_event_type_check check (
    event_type in (
      'email_verified', 'profile_completed', 'account_quarter', 'friendship_accepted',
      'plan_completed', 'safe_arrival_completed', 'meetup_completed', 'achievement_earned',
      'admin_correction', 'moderation_penalty'
    )
  );

update public.achievement_definitions
set name = case code
      when 'first_plan' then 'First Meetup'
      when 'plan_maker' then 'Meetup Maker'
      when 'plan_regular' then 'Meetup Regular'
      when 'open_to_plans' then 'Open to Connect'
      when 'good_check_in' then 'Meetup Check-In'
      when 'safe_traveller' then 'Meetup Check-In Regular'
      when 'trusted_contact' then 'Safety Contact'
      when 'reliable_watcher' then 'Reliable Buddy'
      else name
    end,
    description = case code
      when 'first_plan' then 'You completed your first Meetup.'
      when 'plan_maker' then 'You completed 5 Meetups.'
      when 'plan_regular' then 'You completed 10 Meetups.'
      when 'open_to_plans' then 'You opened nearby discovery for the first time.'
      when 'good_check_in' then 'You completed your first Meetup home check-in.'
      when 'safe_traveller' then 'You completed 5 Meetup safety check-ins.'
      when 'trusted_contact' then 'Historical safety-contact achievement.'
      when 'reliable_watcher' then 'Historical safety check-in achievement.'
      else description
    end,
    is_active = case
      when code in ('trusted_contact','reliable_watcher') then false
      else is_active
    end,
    updated_at = now()
where code in (
  'first_plan','plan_maker','plan_regular','open_to_plans',
  'good_check_in','safe_traveller','trusted_contact','reliable_watcher'
);

-- Persist score credit before Meetup rows age out of the short operational
-- retention window. The first trigger covers the pair that makes a Meetup
-- confirmed; the participant trigger covers later group members who confirm.
create or replace function public.record_meetup_score_from_meetup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.together_at is null and new.together_at is not null then
    insert into public.buddy_score_ledger(
      user_id,event_type,points_delta,source_reference,rule_version,metadata
    )
    select
      p.user_id,
      'meetup_completed',
      40,
      'meetup:' || new.id::text,
      1,
      '{"category":"Meetups"}'::jsonb
    from public.meetup_participants p
    where p.meetup_id = new.id
      and p.met_at is not null
    on conflict (user_id,event_type,source_reference) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.record_meetup_score_from_meetup() from public, anon, authenticated;
grant execute on function public.record_meetup_score_from_meetup() to service_role;

drop trigger if exists meetup_score_on_together on public.meetups;
create trigger meetup_score_on_together
after update of together_at on public.meetups
for each row execute function public.record_meetup_score_from_meetup();

create or replace function public.record_meetup_score_from_participant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.met_at is null and new.met_at is not null
     and exists (
       select 1 from public.meetups m
       where m.id = new.meetup_id and m.together_at is not null
     ) then
    insert into public.buddy_score_ledger(
      user_id,event_type,points_delta,source_reference,rule_version,metadata
    )
    values (
      new.user_id,
      'meetup_completed',
      40,
      'meetup:' || new.meetup_id::text,
      1,
      '{"category":"Meetups"}'::jsonb
    )
    on conflict (user_id,event_type,source_reference) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.record_meetup_score_from_participant() from public, anon, authenticated;
grant execute on function public.record_meetup_score_from_participant() to service_role;

drop trigger if exists meetup_score_on_participant_met on public.meetup_participants;
create trigger meetup_score_on_participant_met
after update of met_at on public.meetup_participants
for each row execute function public.record_meetup_score_from_participant();

-- Best-effort backfill for confirmed Meetups still inside the operational
-- retention window when this migration is applied.
insert into public.buddy_score_ledger(
  user_id,event_type,points_delta,source_reference,rule_version,metadata
)
select
  p.user_id,
  'meetup_completed',
  40,
  'meetup:' || m.id::text,
  1,
  '{"category":"Meetups"}'::jsonb
from public.meetups m
join public.meetup_participants p on p.meetup_id = m.id
where m.together_at is not null
  and p.met_at is not null
on conflict (user_id,event_type,source_reference) do nothing;
