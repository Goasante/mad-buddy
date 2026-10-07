-- Staging applied the Beacon lifecycle before the final Realtime/index
-- hardening landed. Keep this idempotent so clean environments can run it too.

alter table public.meetups
  drop column if exists beacon_status,
  drop column if exists ended_at;

create index if not exists meetup_activity_actor_idx
  on public.meetup_activity(actor_id) where actor_id is not null;
create index if not exists meetups_host_idx
  on public.meetups(host_id) where host_id is not null;
create index if not exists meetups_beacon_set_by_idx
  on public.meetups(beacon_set_by) where beacon_set_by is not null;
create index if not exists meetup_outbox_meetup_idx
  on public.meetup_notification_outbox(meetup_id);
create index if not exists meetup_outbox_recipient_idx
  on public.meetup_notification_outbox(recipient_id);
create index if not exists meetup_outbox_sender_idx
  on public.meetup_notification_outbox(sender_id);

create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

drop policy if exists "meetup participants can receive broadcasts" on realtime.messages;
drop function if exists public.meetup_realtime_allowed(text);

create or replace function private.meetup_realtime_allowed(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and split_part(p_topic,':',1)='meetup'
    and exists(
      select 1 from public.meetup_participants p
      where p.user_id=(select auth.uid())
        and p.meetup_id::text=split_part(p_topic,':',2)
    )
$$;

revoke all on function private.meetup_realtime_allowed(text) from public,anon,authenticated;
grant execute on function private.meetup_realtime_allowed(text) to authenticated;

create policy "meetup participants can receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and private.meetup_realtime_allowed((select realtime.topic()))
);
