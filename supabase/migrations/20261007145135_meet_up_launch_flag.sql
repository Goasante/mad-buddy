insert into public.feature_flags (key, description, status, default_value)
values (
  'meet_up',
  'Meetups: scheduled Muddy meetups and nearby Meet New People discovery.',
  'off',
  false
)
on conflict (key) do update
set description=excluded.description,
    status='off',
    default_value=false,
    updated_at=now();
