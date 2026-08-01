-- Privacy-first, idempotent birthday announcements. The sensitive date stays
-- in profile_birth_details; this ledger contains only UUIDs and the public
-- celebration day used to prevent duplicate delivery.

create table if not exists public.birthday_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  birthday_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  birthday_day date not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'suppressed')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  constraint birthday_notification_delivery_unique unique (birthday_user_id, recipient_id, birthday_day),
  constraint birthday_notification_distinct_users check (birthday_user_id <> recipient_id)
);

create index if not exists birthday_notification_pending_idx
  on public.birthday_notification_deliveries(status, birthday_day)
  where status = 'pending';

alter table public.birthday_notification_deliveries enable row level security;
-- No end-user policies. Recipients read the normal notifications table and
-- only the service-role birthday job reads this internal dedupe ledger.

create or replace function public.birthday_users_for_day(
  p_month integer,
  p_day integer,
  p_include_feb_29 boolean default false
)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select details.user_id
  from public.profile_birth_details details
  where (
    extract(month from details.date_of_birth)::integer = p_month
    and extract(day from details.date_of_birth)::integer = p_day
  ) or (
    p_include_feb_29
    and extract(month from details.date_of_birth)::integer = 2
    and extract(day from details.date_of_birth)::integer = 29
  );
$$;

revoke all on function public.birthday_users_for_day(integer, integer, boolean) from public;
grant execute on function public.birthday_users_for_day(integer, integer, boolean) to service_role;
