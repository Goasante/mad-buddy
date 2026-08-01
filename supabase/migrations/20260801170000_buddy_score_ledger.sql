-- Stage 4: immutable, server-authored Buddy Score ledger.
create table if not exists public.buddy_score_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'email_verified', 'profile_completed', 'account_quarter', 'friendship_accepted',
    'plan_completed', 'safe_arrival_completed', 'achievement_earned',
    'admin_correction', 'moderation_penalty'
  )),
  points_delta integer not null check (points_delta between -500 and 200),
  source_reference text not null check (char_length(source_reference) between 3 and 160),
  rule_version integer not null check (rule_version > 0),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and not (metadata ?| array['message','content','latitude','longitude','location','coordinates','token','email','phone','date_of_birth'])
  ),
  created_at timestamptz not null default now(),
  constraint buddy_score_ledger_source_unique unique (user_id, event_type, source_reference)
);

create index if not exists buddy_score_ledger_user_created_idx on public.buddy_score_ledger(user_id, created_at desc);
alter table public.buddy_score_ledger enable row level security;
create policy "users read own buddy score ledger" on public.buddy_score_ledger for select using (auth.uid() = user_id);
-- No insert/update/delete policy. Clients cannot award points.

create or replace function public.prevent_buddy_score_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Buddy Score history is append-only.';
end;
$$;

drop trigger if exists buddy_score_ledger_immutable on public.buddy_score_ledger;
create trigger buddy_score_ledger_immutable before update or delete on public.buddy_score_ledger
for each row execute function public.prevent_buddy_score_mutation();

create or replace function public.buddy_score_total(target_user_id uuid)
returns table(score_total bigint)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is distinct from target_user_id and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Not authorized';
  end if;
  return query select coalesce(sum(points_delta), 0)::bigint from public.buddy_score_ledger where user_id = target_user_id;
end;
$$;
revoke all on function public.buddy_score_total(uuid) from public;
grant execute on function public.buddy_score_total(uuid) to authenticated, service_role;
