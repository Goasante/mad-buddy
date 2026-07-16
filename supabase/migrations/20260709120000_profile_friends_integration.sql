-- Stage 12 integration helpers.
-- User search can see limited profile fields, but raw location remains private.

create policy "authenticated users can search limited profiles"
on public.profiles
for select
using (
  auth.uid() is not null
  and deleted_at is null
  and auth.uid() <> user_id
  and not public.is_blocked_between(user_id)
);

create policy "friendships service managed insert"
on public.friendships
for insert
with check (
  auth.uid() in (user_one_id, user_two_id)
);

create policy "friendships participants delete"
on public.friendships
for delete
using (auth.uid() in (user_one_id, user_two_id));
