-- SEC-003 high-risk mixed-authority repair: public.reports.
--
-- `reports` is one of the small number of tables with a legitimate signed-in
-- browser write: a user may create a report. The hosted default ACL, however,
-- gives the browser role table-wide INSERT and therefore lets a reporter set
-- server-controlled columns such as `status` during INSERT. RLS only pinned
-- `reporter_id`; it did not pin `status`.
--
-- Keep the real product path, but narrow it to the four columns the application
-- actually sends. Server/admin code retains its service_role authority.

revoke insert, update, delete
  on table public.reports
  from public, anon, authenticated;

-- The report action supplies exactly these four fields. id, status,
-- reported_user_label and audit timestamps remain database/server controlled.
grant insert (reporter_id, reported_user_id, reason, description)
  on table public.reports
  to authenticated;

-- Preserve the existing signed-in read path. This is stated explicitly so the
-- final authority does not depend on hosted platform defaults.
grant select
  on table public.reports
  to authenticated;

-- Defense in depth. Column privileges are the primary control; this policy also
-- ensures that if a future migration accidentally restores broad INSERT, a
-- reporter still cannot create a report already marked reviewing/resolved/etc.
drop policy if exists "reports reporter creates" on public.reports;
create policy "reports reporter creates" on public.reports
  for insert
  to authenticated
  with check (
    auth.uid() = reporter_id
    and status = 'open'::public.report_status
  );

-- Existing SELECT policy intentionally remains unchanged.
-- service_role grants intentionally remain unchanged.
