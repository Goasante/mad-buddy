-- Life events identify a relationship by the canonical sorted pair
-- `<user-a>:<user-b>`. domain_events.resource_id is UUID because most product
-- events point at one database row, so writing the pair there fails with
-- invalid-input-syntax and also makes the Achievements page fail while loading
-- friendship milestones. Keep the generic UUID column intact and give
-- relationship events their correctly typed key.

alter table public.domain_events
  add column if not exists resource_key text;

create index if not exists domain_events_resource_key_idx
  on public.domain_events(resource_type, resource_key, occurred_at desc)
  where resource_key is not null;

comment on column public.domain_events.resource_key is
  'Stable non-UUID resource key. Life relationship events use the canonical sorted user pair; generic row-backed events continue using resource_id.';
