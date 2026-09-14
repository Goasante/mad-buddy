-- Make a profile-photo reorder atomic.
--
-- THE DEFECT THIS CLOSES (PR #92 review):
--
-- 20260808240000 widened the position check to allow -1 as a parking value for
-- a swap, and its column comment promises "no photo is ever left there". The
-- application never kept that promise. It issued THREE separate un-transacted
-- writes -- park the mover at -1, step the displaced row into the vacated slot,
-- land the mover -- and ignored the error on the middle one entirely.
--
-- Two ways that goes wrong, both leaving the gallery inconsistent:
--   * the middle write fails: the third still runs, and the displaced photo is
--     silently lost from its slot;
--   * the process dies between writes: the moving photo is stranded at -1,
--     outside the 0..2 the carousel renders, so it vanishes from the gallery
--     with no way for the owner to recover it from the UI.
--
-- The code comment claimed it "goes through the reorder_profile_photo
-- function". No such function existed. This adds it, so the three writes
-- become one statement in one transaction: it either fully applies or does
-- nothing at all.
--
-- Rollback:
--   drop function if exists public.reorder_profile_photo(uuid, smallint);

create or replace function public.reorder_profile_photo(
  p_photo_id uuid,
  p_new_position smallint
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_current_position smallint;
  v_displaced_id uuid;
begin
  if p_new_position is null or p_new_position < 0 or p_new_position > 2 then
    return query select false, 'Not available.'::text;
    return;
  end if;

  /* Ownership is resolved from the row itself and then enforced below.
     This function is called through the service role, where auth.uid() is
     null, so the caller (a Server Action or an API route) has already proven
     identity and passes it in. The owner check that actually protects this
     path is the caller's scoping plus the explicit comparison here. */
  select user_id, position
    into v_owner_id, v_current_position
    from public.profile_photos
   where id = p_photo_id;

  if v_owner_id is null then
    return query select false, 'Not available.'::text;
    return;
  end if;

  -- Idempotent: moving a photo where it already is is not a failure.
  if v_current_position = p_new_position then
    return query select true, 'Updated.'::text;
    return;
  end if;

  /* The swap, as ONE transaction.
     The unique (user_id, position) constraint means two direct updates collide
     whichever order they run in, so the mover still parks at -1 first. The
     difference from the old application-level version is that all three writes
     now succeed or roll back together: a failure anywhere raises and Postgres
     undoes the rest, so -1 can never be observed by a reader and no row is
     left without a slot. */
  select id
    into v_displaced_id
    from public.profile_photos
   where user_id = v_owner_id
     and position = p_new_position;

  update public.profile_photos
     set position = -1, updated_at = now()
   where id = p_photo_id
     and user_id = v_owner_id;

  if v_displaced_id is not null then
    update public.profile_photos
       set position = v_current_position, updated_at = now()
     where id = v_displaced_id
       and user_id = v_owner_id;
  end if;

  update public.profile_photos
     set position = p_new_position, updated_at = now()
   where id = p_photo_id
     and user_id = v_owner_id;

  return query select true, 'Updated.'::text;
end;
$$;

comment on function public.reorder_profile_photo(uuid, smallint) is
  'Atomically moves a profile photo to another slot, swapping with whatever holds it. All three writes commit together, so the -1 parking value is never observable and no photo is left without a slot.';

/* Browser clients must not call this directly: it is SECURITY DEFINER and
   resolves ownership from the row rather than from auth.uid(). Only the server
   reaches it, through a caller that has already authenticated the person.
   service_role is granted back explicitly -- a bare REVOKE strips it too, and
   that breaks every server path. */
revoke all on function public.reorder_profile_photo(uuid, smallint) from public, anon, authenticated;
grant execute on function public.reorder_profile_photo(uuid, smallint) to service_role;
