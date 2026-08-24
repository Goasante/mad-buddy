-- Break two RLS recursions so the second layer of defence actually runs.
--
-- WHY (MB-GOD-058). Postgres evaluates a table's RLS policy against any query
-- that reads it -- including a query INSIDE that same policy. Two policy
-- families here read their own table, so every read of them raises
--
--     infinite recursion detected in policy for relation "..."
--
-- and returns nothing. Verified from a real authenticated session, per table:
--
--     conversation_members   ERROR: infinite recursion ... "conversation_members"
--     conversations          ERROR: infinite recursion ... "conversation_members"
--     messages               ERROR: infinite recursion ... "conversation_members"
--     group_settings         ERROR: infinite recursion ... "conversation_members"
--     message_mentions       ERROR: infinite recursion ... "conversation_members"
--     message_reactions      ERROR: infinite recursion ... "conversation_members"
--     safe_arrival_sessions  ERROR: infinite recursion ... "safe_arrival_sessions"
--
-- It fails CLOSED -- nothing leaks, and the application is unaffected because
-- messaging authorizes through the service-role client. But RLS on these seven
-- tables is currently INERT rather than protective: the app's own boundary is
-- the only boundary. This restores the layer beneath it.
--
-- FOUR INDEPENDENT CYCLES, not one.
--
-- The audit recorded a single defect propagating outward from
-- `conversation_members`. A live sweep of every RLS-protected table -- reading
-- each one as a real authenticated user and catching the error -- found 15
-- recursing tables in four separate families, of which the audit had named
-- seven in one family:
--
--     conversation_members, conversations, messages, group_settings,
--     message_mentions, message_reactions           (family 1, recorded)
--     safe_arrival_sessions, safe_arrival_contacts  (family 2, NOT recorded)
--     plans, plan_participants, plan_polls,
--     plan_poll_options, plan_poll_votes            (family 3, NOT recorded)
--     event_circles, event_circle_members,
--     event_announcements                           (family 4, NOT recorded)
--
-- Fixing only what was recorded would have left Safe Arrival, Plans and Event
-- Circles exactly as broken as before, while the ledger reported the issue
-- closed. The sweep, not the ledger, defines the scope.
--
-- TWO SHAPES OF CYCLE.
--
-- The audit recorded a single defect propagating outward from
-- `conversation_members`. Reading the live catalogue shows that is true for six
-- tables but NOT for the seventh: `safe_arrival_sessions` recurses on itself
-- through a MUTUAL reference, and would still have been broken after fixing
-- `conversation_members` alone.
--
--   1. SELF-reference. `conversation_members`'s own SELECT policy contains
--      `select 1 from public.conversation_members m ...`. Five other tables
--      (`conversations`, `messages`, `group_settings`, `message_mentions`,
--      `message_reactions`) join through it and inherit the failure. They are
--      not themselves defective and are left untouched: fixing the root fixes
--      all five.
--
--   2. MUTUAL reference, three times over. A parent table is visible via its
--      member table, whose own policy is in turn visible via the parent:
--
--          safe_arrival_sessions <-> safe_arrival_contacts
--          plans                 <-> plan_participants
--          event_circles         <-> event_circle_members
--
--      A -> B -> A. NEITHER policy reads its own table, which is why reading
--      one table at a time missed all three. `plan_polls`,
--      `plan_poll_options`, `plan_poll_votes` and `event_announcements` are not
--      themselves cyclic -- they join through a cycle and inherit it, so
--      cutting the cycle fixes them too.
--
-- THE REPAIR. A `security definer` helper is not subject to RLS on the tables
-- it reads, so the cycle is cut at exactly one point per family. This is the
-- pattern `public.is_friend` already establishes in this schema.
--
-- WHAT WAS DELIBERATELY NOT DONE, because each would trade a broken layer for
-- an absent one: RLS is not disabled; no table is made publicly readable; no
-- policy is widened to `using (true)` or to "any authenticated user"; and
-- nothing is pushed further onto the service-role client. Every policy below
-- expresses the SAME predicate as the one it replaces, evaluated without
-- recursing. Membership still means `status = 'joined'`; message visibility
-- still respects `history_visible_from`.

-- ---------------------------------------------------------------------------
-- 1. Membership, answered without reading the table under its own policy.
-- ---------------------------------------------------------------------------
-- `stable` (not `volatile`) so the planner may evaluate it once per query
-- rather than once per row -- the difference between a policy that scales and
-- one that does not.
--
-- Takes the conversation id rather than returning a set of ids: the caller
-- always has a specific conversation in hand, and a set-returning variant would
-- have to materialise every membership the user has on every row tested.
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = auth.uid()
      and m.status = 'joined'
  );
$$;

comment on function public.is_conversation_member(uuid) is
  'True when the CURRENT user is a joined member of the conversation. security definer so it can be called from the conversation_members RLS policy without recursion (MB-GOD-058). Reads auth.uid() itself and takes no user argument, so it cannot be used to probe anybody else membership.';

-- The traveller side of a Safe Arrival session, for the same reason.
create or replace function public.is_safe_arrival_traveller(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.safe_arrival_sessions s
    where s.id = p_session_id
      and s.traveller_id = auth.uid()
  );
$$;

comment on function public.is_safe_arrival_traveller(uuid) is
  'True when the CURRENT user is the traveller of the session. Breaks the mutual recursion between safe_arrival_sessions and safe_arrival_contacts (MB-GOD-058).';

-- The creator side of a Plan, for the same reason.
create or replace function public.is_plan_creator(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = p_plan_id
      and p.creator_id = auth.uid()
  );
$$;

comment on function public.is_plan_creator(uuid) is
  'True when the CURRENT user created the plan. Breaks the mutual recursion between plans and plan_participants (MB-GOD-058).';

-- The owner side of an Event Circle, for the same reason.
create or replace function public.is_event_circle_owner(p_event_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.event_circles c
    where c.id = p_event_circle_id
      and c.owner_id = auth.uid()
  );
$$;

comment on function public.is_event_circle_owner(uuid) is
  'True when the CURRENT user owns the event circle. Breaks the mutual recursion between event_circles and event_circle_members (MB-GOD-058).';

-- GRANTS, written explicitly.
--
-- Revoking without re-granting strips `service_role` along with everybody else
-- and breaks the server -- a hazard this codebase has already been bitten by.
--
-- `anon` IS GRANTED, which is not the reflex and is the point.
--
-- The reflex is to copy `is_friend` and revoke from `public, anon`. Doing that
-- here was measured and was WRONG. `anon` holds SELECT on all five tables
-- (conversations, conversation_members, messages, safe_arrival_sessions,
-- safe_arrival_contacts), so a signed-out PostgREST client really does reach
-- these policies -- and a policy that cannot execute its own helper raises
--
--     ERROR: permission denied for function is_conversation_member
--
-- instead of returning nothing. That is still fail-closed, but it is the wrong
-- SHAPE of closed: an empty list becomes a 500, and the error names a function
-- an anonymous caller should not learn exists. The behaviour matrix caught it
-- as five failing cells on the `anon` row while every other persona passed.
--
-- `is_friend` differs because nothing calls it from a policy on an
-- anon-readable table; it is called directly by authenticated code.
--
-- Granting execute to `anon` gives away nothing. Both helpers take no user
-- argument and read `auth.uid()` themselves, which is NULL for a signed-out
-- caller, so every call can only ever return false. `anon` gains the ability to
-- be told "no" cheaply -- which is exactly what the policy needs in order to
-- return an empty set rather than an error.
revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.is_safe_arrival_traveller(uuid) from public;
revoke all on function public.is_plan_creator(uuid) from public;
revoke all on function public.is_event_circle_owner(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_safe_arrival_traveller(uuid) to anon, authenticated, service_role;
grant execute on function public.is_plan_creator(uuid) to anon, authenticated, service_role;
grant execute on function public.is_event_circle_owner(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The self-recursive policy, rewritten to the same meaning.
-- ---------------------------------------------------------------------------
-- Was: `auth.uid() = user_id OR EXISTS (SELECT 1 FROM conversation_members ...)`
-- Now: the identical disjunction with the subquery moved behind the helper.
--
-- The `auth.uid() = user_id` arm is kept and kept FIRST. It is not redundant:
-- it is what lets an `invited` or `removed` member still see their own row (so
-- an invitation is visible before it is accepted), and being a cheap column
-- comparison it short-circuits before the helper is called at all.
drop policy if exists "conversation members visible to members" on public.conversation_members;
create policy "conversation members visible to members" on public.conversation_members
  for select using (
    auth.uid() = user_id
    or public.is_conversation_member(conversation_members.conversation_id)
  );

-- ---------------------------------------------------------------------------
-- 3. The mutual recursion, cut on ONE side only.
-- ---------------------------------------------------------------------------
-- Cutting one side is sufficient to break a two-node cycle, and cutting only
-- one keeps as much of the policy set as possible expressed in plain SQL.
--
-- The contacts policy is the side rewritten, because its recursive arm is the
-- traveller check -- a single-table, single-column predicate that maps exactly
-- onto a helper. The sessions-side policy (`visible to contacts`) is then no
-- longer part of a cycle and is left exactly as it is.
drop policy if exists "safe arrival contacts visible to participants" on public.safe_arrival_contacts;
create policy "safe arrival contacts visible to participants" on public.safe_arrival_contacts
  for select using (
    auth.uid() = contact_user_id
    or public.is_safe_arrival_traveller(safe_arrival_contacts.session_id)
  );

-- ---------------------------------------------------------------------------
-- 4. The Plans cycle, cut on the participants side.
-- ---------------------------------------------------------------------------
-- Same shape as Safe Arrival, and the same choice of side: the recursive arm of
-- the participants policy is the creator check, a single-column predicate that
-- maps exactly onto a helper. The policy on `plans` then leaves the cycle
-- untouched, and `plan_polls`, `plan_poll_options` and `plan_poll_votes` --
-- which join through `plans` -- are fixed without being modified.
--
-- Note the `rsvp_status <> 'removed'` condition lives in the POLICY ON PLANS,
-- which is not rewritten here, so participation semantics are unchanged.
drop policy if exists "participants visible to plan members" on public.plan_participants;
create policy "participants visible to plan members" on public.plan_participants
  for select using (
    auth.uid() = user_id
    or public.is_plan_creator(plan_participants.plan_id)
  );

-- ---------------------------------------------------------------------------
-- 5. The Event Circles cycle, cut on the members side.
-- ---------------------------------------------------------------------------
-- And again. `event_announcements` joins through `event_circle_members` and is
-- fixed by this without being modified.
drop policy if exists "event circle members visible to members" on public.event_circle_members;
create policy "event circle members visible to members" on public.event_circle_members
  for select using (
    auth.uid() = user_id
    or public.is_event_circle_owner(event_circle_members.event_circle_id)
  );

-- ROLLBACK (for the production application order; not run here):
--
--   drop policy if exists "conversation members visible to members" on public.conversation_members;
--   create policy "conversation members visible to members" on public.conversation_members
--     for select using (
--       auth.uid() = user_id
--       or exists (select 1 from public.conversation_members m
--                  where m.conversation_id = conversation_members.conversation_id
--                    and m.user_id = auth.uid() and m.status = 'joined')
--     );
--
--   drop policy if exists "safe arrival contacts visible to participants" on public.safe_arrival_contacts;
--   create policy "safe arrival contacts visible to participants" on public.safe_arrival_contacts
--     for select using (
--       auth.uid() = contact_user_id
--       or exists (select 1 from public.safe_arrival_sessions s
--                  where s.id = safe_arrival_contacts.session_id and s.traveller_id = auth.uid())
--     );
--
--   drop policy if exists "participants visible to plan members" on public.plan_participants;
--   create policy "participants visible to plan members" on public.plan_participants
--     for select using (
--       auth.uid() = user_id
--       or exists (select 1 from public.plans pl
--                  where pl.id = plan_participants.plan_id and pl.creator_id = auth.uid())
--     );
--
--   drop policy if exists "event circle members visible to members" on public.event_circle_members;
--   create policy "event circle members visible to members" on public.event_circle_members
--     for select using (
--       auth.uid() = user_id
--       or exists (select 1 from public.event_circles c
--                  where c.id = event_circle_members.event_circle_id and c.owner_id = auth.uid())
--     );
--
--   drop function if exists public.is_conversation_member(uuid);
--   drop function if exists public.is_safe_arrival_traveller(uuid);
--   drop function if exists public.is_plan_creator(uuid);
--   drop function if exists public.is_event_circle_owner(uuid);
--
-- Rolling back restores the recursion -- i.e. it restores DENY-ALL on these
-- tables. That is the pre-migration state and is safe, because the application
-- does not read them through the RLS client. There is no window in which
-- rolling back exposes more than rolling forward.
