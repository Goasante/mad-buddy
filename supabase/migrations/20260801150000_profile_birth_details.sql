-- Stage 2: private date-of-birth storage and derived-profile privacy controls.
-- Raw dates remain owner-only. Other users receive only server-derived values.

create table if not exists public.profile_birth_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_birth_details enable row level security;

create policy "profile birth details owner select" on public.profile_birth_details
  for select using (auth.uid() = user_id);
create policy "profile birth details owner insert" on public.profile_birth_details
  for insert with check (auth.uid() = user_id);
create policy "profile birth details owner update" on public.profile_birth_details
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profile birth details owner delete" on public.profile_birth_details
  for delete using (auth.uid() = user_id);

revoke all on table public.profile_birth_details from anon;
grant select, insert, update, delete on table public.profile_birth_details to authenticated;

create or replace function public.validate_profile_birth_details()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.date_of_birth > current_date then
    raise exception 'date of birth cannot be in the future' using errcode = '22007';
  end if;
  if new.date_of_birth < (current_date - interval '120 years')::date then
    raise exception 'date of birth is outside the supported range' using errcode = '22007';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_birth_details_validate on public.profile_birth_details;
create trigger profile_birth_details_validate
before insert or update on public.profile_birth_details
for each row execute function public.validate_profile_birth_details();

alter table public.profile_field_privacy
  drop constraint if exists profile_field_privacy_field_name_check;

alter table public.profile_field_privacy
  add constraint profile_field_privacy_field_name_check check (
    field_name in (
      'bio', 'institution', 'programme', 'graduation_year', 'general_area',
      'interests', 'pronouns', 'birthday', 'age', 'zodiac'
    )
  );
