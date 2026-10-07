-- Product consolidation: Meet Up replaces UpFor/App4, Plans and Safe Arrival as the
-- user-facing real-world meeting product. Historical rows remain for audit and
-- compatibility, but their launch controls are archived.
insert into public.feature_flags (key, description, status, default_value)
values (
  'meet_up',
  'Meet Up: scheduled Muddies meetups and nearby Meet New People discovery.',
  'on',
  true
)
on conflict (key) do update
set description=excluded.description,
    status='on',
    default_value=true,
    updated_at=now();

update public.feature_flags
set status='archived',
    default_value=false,
    updated_at=now()
where key in ('upfor','safe_arrival');
