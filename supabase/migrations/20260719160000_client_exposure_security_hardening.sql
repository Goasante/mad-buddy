-- Client-exposure security hardening.
-- Browser roles retain only the reads and writes required by the UI. Sensitive
-- mutations go through authenticated server actions, route handlers, or the
-- narrowly granted accept_friend_request RPC.

-- A participant could previously manufacture an accepted friendship directly.
drop policy if exists "friendships service managed insert" on public.friendships;
revoke insert on table public.friendships from anon, authenticated;

-- Friend and meetup ownership columns must never be writable from DevTools.
drop policy if exists "friend requests participants update" on public.friend_requests;
revoke insert, update on table public.friend_requests from anon, authenticated;

drop policy if exists "meetup requests participants update" on public.meetup_requests;
revoke insert, update on table public.meetup_requests from anon, authenticated;

-- Notifications originate from trusted application events. Users can read
-- their own rows; read/delete mutations are performed by authenticated routes.
drop policy if exists "notifications owner access" on public.notifications;
create policy "notifications owner reads"
  on public.notifications for select
  using (auth.uid() = user_id);
revoke insert, update, delete on table public.notifications from anon, authenticated;

-- Raw coordinates are accepted only by /api/location/update after server-side
-- authentication, validation, feature checks, and rate limiting.
revoke insert, update, delete on table public.user_locations from anon, authenticated;

-- Search results are projected by a server action. RLS no longer makes every
-- non-blocked profile row directly enumerable from the browser.
drop policy if exists "authenticated users can search limited profiles" on public.profiles;

-- The old subject policy exposed internal reason codes and case identifiers.
drop policy if exists "restrictions visible to subject" on public.user_restrictions;
revoke select, insert, update, delete on table public.user_restrictions from anon, authenticated;

drop policy if exists "emergency controls readable" on public.emergency_controls;
create policy "emergency controls authenticated reads"
  on public.emergency_controls for select
  using (auth.uid() is not null);

drop policy if exists "feature flags readable" on public.feature_flags;
create policy "feature flags authenticated reads"
  on public.feature_flags for select
  using (auth.uid() is not null and status <> 'archived');

-- Ticket owners may create and read their tickets, but cannot assign themselves,
-- raise priority, or alter moderation workflow fields through a direct query.
drop policy if exists "support tickets owner access" on public.support_tickets;
create policy "support tickets owner reads"
  on public.support_tickets for select
  using (auth.uid() = user_id);
create policy "support tickets owner creates"
  on public.support_tickets for insert
  with check (
    auth.uid() = user_id
    and status = 'new'
    and priority = 'normal'
    and assigned_to is null
    and resolved_at is null
  );
revoke update, delete on table public.support_tickets from anon, authenticated;

-- Explicitly restrict helper and maintenance function execution. PostgreSQL
-- grants EXECUTE to PUBLIC by default, even when table RLS is enabled.
revoke all on function public.consume_rate_limit(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, text, integer, integer) to service_role;

revoke all on function public.cleanup_expired_private_location() from public, anon, authenticated;
revoke all on function public.cleanup_expired_proximity_events() from public, anon, authenticated;
revoke all on function public.prepare_deleted_user_reports(uuid) from public, anon, authenticated;
revoke all on function public.claim_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.cleanup_expired_private_location() to service_role;
grant execute on function public.cleanup_expired_proximity_events() to service_role;
grant execute on function public.prepare_deleted_user_reports(uuid) to service_role;
grant execute on function public.claim_jobs(text, integer, integer) to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_audit_mutation() from public, anon, authenticated;
revoke all on function public.prevent_domain_event_mutation() from public, anon, authenticated;
revoke all on function public.prevent_pending_request_for_existing_friendship() from public, anon, authenticated;

revoke all on function public.is_friend(uuid) from public, anon;
revoke all on function public.is_blocked_between(uuid) from public, anon;
revoke all on function public.location_confidence_for_accuracy(double precision) from public, anon;
grant execute on function public.is_friend(uuid) to authenticated, service_role;
grant execute on function public.is_blocked_between(uuid) to authenticated, service_role;
grant execute on function public.location_confidence_for_accuracy(double precision) to authenticated, service_role;

revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated, service_role;
