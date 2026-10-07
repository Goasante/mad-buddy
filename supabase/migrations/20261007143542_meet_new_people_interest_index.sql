-- Cover the participant-side foreign key and future per-user discovery lookups.
create index if not exists meetup_discovery_interests_user_idx
  on public.meetup_discovery_interests(user_id, status, updated_at desc);
