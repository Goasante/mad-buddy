-- UpFor Stage 3 — close the ended-friendship RLS gap, and let a participant
-- withdraw.
--
-- Two independent fixes, together because both are narrow policy work on the
-- same feature.

-- ---------------------------------------------------------------------------
-- 1. An ENDED friendship must not read an active UpFor.
-- ---------------------------------------------------------------------------
-- The existing policy checks that a `friendships` row EXISTS for the pair, but
-- not that the friendship is still live. Since Phase 3.2A, `ended_at IS NULL`
-- has been the canonical definition of "currently Muddies" — a soft-ended
-- friendship keeps its row, so "a row exists" and "they are friends" are no
-- longer the same question.
--
-- The practical effect today is limited: every read path goes through
-- `canViewHangout()`, which uses `areApprovedMuddies` and does check ended_at.
-- But that means the guarantee lives entirely in application code, and RLS —
-- the layer that is supposed to hold when application code forgets — would
-- pass an unfriended user straight through. Any future direct query, view or
-- realtime subscription would leak.
--
-- Everything else about the policy is preserved exactly: status, expiry, and
-- the bidirectional pair check. This narrows access; it cannot widen it.
--
-- Rollback: recreate the policy without the two `ended_at is null` clauses.

drop policy if exists "muddies read active hangouts" on public.hangout_sessions;

create policy "muddies read active hangouts" on public.hangout_sessions
  for select using (
    status = 'active'
    and ends_at > now()
    and exists (
      select 1 from public.friendships f
      where (
        (f.user_one_id = auth.uid() and f.user_two_id = hangout_sessions.owner_id)
        or (f.user_two_id = auth.uid() and f.user_one_id = hangout_sessions.owner_id)
      )
      -- The addition. An ended friendship is not a friendship.
      and f.ended_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 2. A requester may withdraw their own participation.
-- ---------------------------------------------------------------------------
-- `hangout_requests` already models participation: pending is "I asked",
-- accepted is "I am going". Withdrawing is a third transition of the same row,
-- so no second membership table is introduced — the request IS the membership.
--
-- The policy is deliberately the NARROWEST that makes leaving possible:
--
--   * USING restricts which rows are visible to the update at all — only the
--     caller's own, and only while pending or accepted. A declined or already
--     cancelled row is not updatable, so this cannot resurrect a request the
--     owner refused.
--
--   * WITH CHECK restricts what the row may become — `cancelled` and nothing
--     else. Without it, a requester could set their own row to 'accepted' and
--     admit themselves to an UpFor the owner never approved. That is the
--     privilege escalation this clause exists to prevent, and it is why this
--     is not a general "update own row" policy.
--
-- What this does NOT grant: changing someone else's request, changing the
-- session, or accepting oneself. The owner's accept/decline continues to run
-- through the service role in `respondHangoutRequestAction`, unaffected.
--
-- Rollback: drop policy "hangout requests self cancel" on public.hangout_requests;

create policy "hangout requests self cancel" on public.hangout_requests
  for update
  using (
    auth.uid() = requester_id
    and status in ('pending', 'accepted')
  )
  with check (
    auth.uid() = requester_id
    and status = 'cancelled'
  );

comment on policy "hangout requests self cancel" on public.hangout_requests is
  'Lets a requester withdraw their own pending or accepted request. WITH CHECK pins the destination to cancelled so this can never be used to self-accept.';

-- ---------------------------------------------------------------------------
-- Capacity note, deliberately NOT a schema change.
-- ---------------------------------------------------------------------------
-- Every capacity read already counts `status = 'accepted'` only, so a
-- cancelled row stops counting the moment it is cancelled and the freed seat
-- is immediately available. No trigger, no denormalised counter, and nothing
-- to drift: the count is derived from the same rows the policy governs.
