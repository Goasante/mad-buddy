-- A global Access window must outlive its creator. The original RESTRICT
-- reference blocked Auth account deletion for any admin who opened one.
alter table public.access_global_windows
  alter column created_by drop not null;

alter table public.access_global_windows
  drop constraint if exists access_global_windows_created_by_fkey;

alter table public.access_global_windows
  add constraint access_global_windows_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;
