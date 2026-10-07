-- Meetups replaces UpFor as Mad Buddy's coordination product.
-- Keep Meetups locked by default while making the admin launch toggle exist.
insert into public.feature_flags (key, description, status, default_value)
values (
  'meet_up',
  'Meetups: invite Muddies or meet new people nearby, then coordinate the meetup.',
  'off',
  false
)
on conflict (key) do update
set description = excluded.description,
    status = 'off',
    default_value = false,
    updated_at = now();

-- Retired product surfaces must not be launchable again from stale flags.
update public.feature_flags
set status = 'archived',
    default_value = false,
    updated_at = now()
where key in ('upfor', 'safe_arrival');
