insert into public.feature_flags (key, description, status, default_value)
values (
  'meet_up',
  'Meet Up: scheduled Muddy meetups and nearby Meet New People discovery.',
  'on',
  true
)
on conflict (key) do update
set description=excluded.description,
    status='on',
    default_value=true,
    updated_at=now();
