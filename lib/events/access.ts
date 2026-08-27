import "server-only";

import { canViewEvent, canManageEvent, type EventAudienceContext } from "@/lib/events/rules";
import { isBlockedEitherDirection } from "@/lib/social/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventStatus } from "@/lib/supabase/database.types";

/**
 * The one authority for "may this viewer open this specific Event".
 *
 * Discovery and direct access are different questions and used to be answered
 * by the same code: the Event page loaded the whole discovery feed and searched
 * it for the requested id. That made an unlisted `link` Event unreachable by
 * its own link -- the feed had already excluded it -- and it meant every
 * surface that wanted one Event paid for a hundred.
 *
 * This asks the direct question directly. The pure rules in lib/events/rules.ts
 * decide; this module's job is to fetch the facts they need.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type EventAccessDenial =
  | "not_found"
  | "draft"
  | "not_invited"
  | "not_community_member"
  | "blocked";

export type EventAccessResult =
  | { ok: true; event: EventRow; canManage: boolean; isHost: boolean }
  | { ok: false; reason: EventAccessDenial };

export type EventRow = {
  id: string;
  host_id: string;
  name: string;
  description: string | null;
  venue_label: string | null;
  starts_at: string;
  ends_at: string;
  visibility: string;
  status: EventStatus;
  checkin_opens_minutes_before: number;
};

/**
 * Resolves the viewer's audience relationship to one Event.
 *
 * Two lookups at most, and only the ones the audience actually needs: an
 * unlisted or public Event asks nothing, so it costs nothing.
 */
async function audienceContextFor(
  admin: Admin,
  event: EventRow,
  viewerId: string
): Promise<EventAudienceContext> {
  const base: EventAudienceContext = { visibility: event.visibility, hostId: event.host_id };
  if (event.visibility !== "invite" && event.visibility !== "community") return base;

  const { data: targets } = await admin
    .from("event_audience_targets")
    .select("target_type, target_id")
    .eq("event_id", event.id);
  if (!targets?.length) return base;

  const isInvited = targets.some((t) => t.target_type === "user" && t.target_id === viewerId);
  const communityIds = targets.filter((t) => t.target_type === "community").map((t) => t.target_id);
  if (communityIds.length === 0) return { ...base, isInvited };

  // Groups are group conversations; `joined` is the only status that counts.
  // An invited-but-unjoined member has not accepted the Group, and a removed
  // one must lose the Event along with it.
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", viewerId)
    .eq("status", "joined")
    .in("conversation_id", communityIds);

  return {
    ...base,
    isInvited,
    hasCommunityTarget: true,
    isCommunityMember: Boolean(memberships?.length)
  };
}

/**
 * Loads one Event if -- and only if -- this viewer is allowed to open it.
 *
 * Fails closed on every unknown: a missing Event, an unrecognised audience and
 * a blocked host all return a refusal rather than a partial object the caller
 * might render.
 */
export async function getEventForViewer(
  eventId: string,
  viewerId: string
): Promise<EventAccessResult> {
  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select(
      "id, host_id, name, description, venue_label, starts_at, ends_at, visibility, status, checkin_opens_minutes_before"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, reason: "not_found" };

  const row = event as EventRow;
  const isHost = row.host_id === viewerId;

  if (!isHost) {
    /* A block hides the Event completely rather than explaining itself. The
     * refusal is deliberately the same shape as "not found": telling somebody
     * an Event exists but they are blocked from it discloses both the Event
     * and the block. */
    if (await isBlockedEitherDirection(admin, viewerId, row.host_id)) {
      return { ok: false, reason: "blocked" };
    }
  }

  const audience = await audienceContextFor(admin, row, viewerId);
  if (!canViewEvent({ ...audience, status: row.status }, viewerId)) {
    if (row.status === "draft") return { ok: false, reason: "draft" };
    if (row.visibility === "invite") return { ok: false, reason: "not_invited" };
    if (row.visibility === "community") return { ok: false, reason: "not_community_member" };
    return { ok: false, reason: "not_found" };
  }

  const isAdmin = isHost ? false : await viewerIsEventAdmin(admin, row.id, viewerId);
  return { ok: true, event: row, isHost, canManage: canManageEvent(row2ctx(row), viewerId, isAdmin) };
}

function row2ctx(row: EventRow): { hostId: string } {
  return { hostId: row.host_id };
}

/** Whether this viewer holds a delegated admin seat on the Event. */
export async function viewerIsEventAdmin(
  admin: Admin,
  eventId: string,
  viewerId: string
): Promise<boolean> {
  const { data } = await admin
    .from("event_admins")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", viewerId)
    .maybeSingle();
  return Boolean(data);
}
