-- Event presence is opt-in, at the database layer too (Plans + Events, Stage E).
--
-- Two defects, both in the same direction: the database was more permissive
-- about presence than the product promises.
--
-- 1. `event_glow_enabled` defaulted to TRUE. The column's own comment says
--    "being present never implies being visible" -- the default said the
--    opposite. Any insert that omitted the column (the QR scan path did, and
--    the mobile check-in hardcoded true) silently opted the person into being
--    listed as present to their Muddies. The application layer now passes the
--    flag explicitly on every path; this makes the storage default agree, so a
--    future writer that forgets the column gets the private behaviour.
--
-- 2. The event-host SELECT policy read EVERY check-in row for the host's own
--    event, with no regard for the visibility the attendee chose. Someone who
--    checked in as 'private' or 'anonymous_count' -- the two settings that
--    exist precisely to say "count me, don't name me" -- was still fully
--    readable by the host through PostgREST with their own JWT, name-linked
--    via user_id. Hosts do legitimately need attendance, so the policy is
--    narrowed rather than dropped: it now returns only the rows whose author
--    accepted being identifiable ('participants' and 'selected_muddies').
--
--    Attendee COUNTS are unaffected: counting is done server-side through the
--    service role, which RLS does not constrain. This only closes direct
--    name-linked reads of rows whose owner asked not to be named.
--
-- The owner policy ("check ins owner full access") is untouched, so a private
-- attendee still has complete access to their own row.
--
-- NOT a data migration. Existing rows are deliberately NOT rewritten: the
-- historical rows record what was true when they were written, and silently
-- flipping past check-ins would falsify that record. The default governs new
-- rows only. Production currently holds zero check_ins rows, so there is no
-- backfill question to answer in practice.
--
-- Rollback:
--   alter table public.check_ins alter column event_glow_enabled set default true;
--   drop policy if exists "check ins readable by event host" on public.check_ins;
--   create policy "check ins readable by event host" on public.check_ins
--     for select using (
--       context_type = 'event'
--       and exists (
--         select 1 from public.events e
--         where e.id = check_ins.context_id and e.host_id = auth.uid()
--       )
--     );

alter table public.check_ins
  alter column event_glow_enabled set default false;

comment on column public.check_ins.event_glow_enabled is
  'Opt-in per check-in: true only when the attendee explicitly chose "Let my Muddies see I''m here". Defaults to FALSE so an omitted column can never broadcast presence (spec §34).';

drop policy if exists "check ins readable by event host" on public.check_ins;

-- The event host may read attendance for their own event -- but only the rows
-- whose author accepted being identifiable. 'private' and 'anonymous_count'
-- check-ins stay unreadable, including to the host.
create policy "check ins readable by event host" on public.check_ins
  for select using (
    context_type = 'event'
    and visibility in ('participants', 'selected_muddies')
    and exists (
      select 1 from public.events e
      where e.id = check_ins.context_id and e.host_id = auth.uid()
    )
  );
