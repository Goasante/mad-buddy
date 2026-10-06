-- Future UpFors can be discovered and joined through the existing audience policies.
-- Keep the same audience checks; only remove the started-time restriction.
drop policy if exists "muddies read active hangouts" on public.hangout_sessions;
create policy "muddies read active hangouts" on public.hangout_sessions for select
using (
  status = 'active' and ends_at > now()
  and exists (
    select 1 from public.friendships f
    where ((f.user_one_id = auth.uid() and f.user_two_id = hangout_sessions.owner_id)
      or (f.user_two_id = auth.uid() and f.user_one_id = hangout_sessions.owner_id))
    and f.ended_at is null
  )
);

drop policy if exists "opted-in upfors are discovery eligible" on public.hangout_sessions;
create policy "opted-in upfors are discovery eligible" on public.hangout_sessions for select
using (
  discovery_scope = 'nearby' and status = 'active' and ends_at > now()
  and auth.uid() is not null and owner_id <> auth.uid()
);

comment on column public.hangout_sessions.timezone is
  'Validated IANA timezone for an UpFor scheduled now or on a future date.';
