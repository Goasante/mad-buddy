-- Profile date of birth is an age-gate authority, so its correction budget
-- must be enforced in the database rather than by a read-then-write service.

create or replace function public.save_profile_date_of_birth(p_date date)
returns table (outcome text, can_correct boolean)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_existing public.profile_birth_details%rowtype;
  v_inserted boolean := false;
begin
  if v_user_id is null then
    raise exception 'profile_birth_details:authentication_required' using errcode = '42501';
  end if;

  if p_date is null then
    raise exception 'profile_birth_details:date_required' using errcode = '22007';
  end if;
  if p_date > current_date then
    raise exception 'profile_birth_details:future_date' using errcode = '22007';
  end if;
  if p_date < (current_date - interval '120 years')::date then
    raise exception 'profile_birth_details:outside_supported_range' using errcode = '22007';
  end if;

  -- ON CONFLICT serializes two first-write attempts on the primary key. The
  -- loser then locks and evaluates the row produced by the winner below.
  insert into public.profile_birth_details (user_id, date_of_birth)
  values (v_user_id, p_date)
  on conflict (user_id) do nothing
  returning true into v_inserted;

  if v_inserted then
    return query select 'created'::text, true;
    return;
  end if;

  select * into strict v_existing
    from public.profile_birth_details
   where user_id = v_user_id
   for update;

  -- An unchanged general Profile save is idempotent and never spends or
  -- requires a correction, including after the correction has been used.
  if v_existing.date_of_birth = p_date then
    return query select 'unchanged'::text, v_existing.correction_used_at is null;
    return;
  end if;

  if v_existing.correction_used_at is not null then
    raise exception 'profile_birth_details:correction_locked' using errcode = 'P0001';
  end if;

  update public.profile_birth_details
     set date_of_birth = p_date,
         correction_used_at = now(),
         updated_at = now()
   where user_id = v_user_id;

  return query select 'corrected'::text, false;
end;
$fn$;

revoke all on function public.save_profile_date_of_birth(date) from public;
revoke all on function public.save_profile_date_of_birth(date) from anon;
grant execute on function public.save_profile_date_of_birth(date) to authenticated;

-- Owners may read their raw date in Profile. Every mutation goes through the
-- function above so a browser, mobile client, or raced request cannot reset
-- the correction marker or delete the age-gate authority.
drop policy if exists "profile birth details owner insert" on public.profile_birth_details;
drop policy if exists "profile birth details owner update" on public.profile_birth_details;
drop policy if exists "profile birth details owner delete" on public.profile_birth_details;
revoke insert, update, delete on table public.profile_birth_details from authenticated;
