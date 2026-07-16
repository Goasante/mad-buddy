create table public.stripe_webhook_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

create policy "stripe webhook events service only"
on public.stripe_webhook_events
for all
using (false)
with check (false);

create index stripe_webhook_events_type_idx on public.stripe_webhook_events(type);
