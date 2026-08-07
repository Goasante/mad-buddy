import "server-only";

import { LIFE_RESOURCE_TYPE, relationshipId } from "@/lib/life/events";
import {
  buildTimeline,
  TIMELINE_PAGE_SIZE,
  type TimelineResult,
  type TimelineSourceRow
} from "@/lib/life/timeline";
import { LIFE_TIMELINE_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import { isBlockedEitherDirection } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * The canonical Timeline loader.
 *
 * Server-authoritative: every gate is applied here, and the pure projection
 * in lib/life/timeline.ts only arranges rows this function already decided
 * the viewer may see. A client cannot widen its own access by asking
 * differently.
 *
 * Order of checks is deliberate and fails closed at each step:
 *
 *   1. feature flag   — Life is dark until switched on
 *   2. blocking       — overrides everything, both directions
 *   3. viewer's reset — their own private cut-off
 *   4. visibility     — per-event, in the pure projection
 */
export async function loadRelationshipTimeline(
  admin: Admin,
  input: {
    viewerId: string;
    otherUserId: string;
    limit?: number;
    beforeMs?: number;
  }
): Promise<TimelineResult> {
  const empty: TimelineResult = { entries: [], nextBeforeMs: null };

  // 1. Dark by default. No flag, no timeline.
  if (!(await isFeatureEnabled(admin, LIFE_TIMELINE_FLAG))) return empty;

  // A timeline about yourself is not a relationship.
  if (input.viewerId === input.otherUserId) return empty;

  // 2. Blocking wins over everything, in either direction. Returning nothing
  //    rather than a filtered list: a partial timeline still reveals that the
  //    other person exists and acted.
  if (await isBlockedEitherDirection(admin, input.viewerId, input.otherUserId)) return empty;

  const relationship = relationshipId(input.viewerId, input.otherUserId);

  // 3. The viewer's own cut-off, if they have cleared this timeline.
  const { data: reset } = await admin
    .from("life_timeline_resets")
    .select("hidden_before")
    .eq("user_id", input.viewerId)
    .eq("relationship_id", relationship)
    .maybeSingle();
  const hiddenBeforeMs = reset?.hidden_before ? Date.parse(reset.hidden_before) : null;

  const limit = input.limit ?? TIMELINE_PAGE_SIZE;

  // Read one page's worth of candidates plus headroom: per-event visibility
  // is applied after the read, so some rows will be filtered out.
  const { data, error } = await admin
    .from("domain_events")
    .select("event_type, actor_id, occurred_at, payload")
    .eq("resource_type", LIFE_RESOURCE_TYPE)
    .eq("resource_id", relationship)
    .order("occurred_at", { ascending: false })
    .limit(limit * 4);

  if (error || !data) return empty;

  const rows: TimelineSourceRow[] = data.map((row) => ({
    eventType: row.event_type,
    actorId: row.actor_id ?? "",
    occurredAt: row.occurred_at,
    payload: (row.payload ?? {}) as Record<string, unknown>
  }));

  // 4. Per-event visibility, ordering and pagination.
  return buildTimeline(rows, input.viewerId, {
    limit,
    beforeMs: input.beforeMs,
    hiddenBeforeMs
  });
}

/**
 * Clear the viewer's own timeline for one relationship.
 *
 * Records a cut-off; deletes nothing. The other participant is unaffected and
 * cannot detect that it happened, and events after this instant appear
 * normally — so clearing is a fresh start, not a permanent blindfold.
 */
export async function clearRelationshipTimeline(
  admin: Admin,
  input: { viewerId: string; otherUserId: string; nowMs?: number }
): Promise<{ ok: boolean }> {
  if (input.viewerId === input.otherUserId) return { ok: false };

  const hiddenBefore = new Date(input.nowMs ?? Date.now()).toISOString();
  const relationship = relationshipId(input.viewerId, input.otherUserId);

  // Upsert on (user_id, relationship_id): clearing twice moves the cut-off
  // forward rather than accumulating rows.
  const { error } = await admin
    .from("life_timeline_resets")
    .upsert(
      {
        user_id: input.viewerId,
        relationship_id: relationship,
        hidden_before: hiddenBefore,
        updated_at: hiddenBefore
      },
      { onConflict: "user_id,relationship_id" }
    );

  return { ok: !error };
}
