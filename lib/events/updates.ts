import "server-only";

import { z } from "zod";
import { getEventForViewer, viewerIsEventAdmin } from "@/lib/events/access";
import { isEventOwner } from "@/lib/events/rules";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventUpdatePriority, EventUpdateReactionType } from "@/lib/supabase/database.types";

/**
 * Event Updates: host broadcast, attendees react.
 *
 * Attached to the Event rather than to an Event Circle, because circle
 * membership is capped by the host subscription (50 free / 250 plus) and the
 * ability to announce a moved gate must never depend on what the host pays.
 *
 * There is no attendee composer and no reply thread by design. This is a
 * noticeboard: one voice, many readers, lightweight reactions.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;
export type UpdateResult = { ok: boolean; message: string; updateId?: string };

export const REACTION_TYPES = ["heart", "fire", "applause", "wow"] as const;

export type EventUpdateView = {
  id: string;
  body: string;
  priority: EventUpdatePriority;
  createdAt: string;
  editedAt: string | null;
  authorName: string;
  /** Aggregate only -- v1 never discloses who reacted. */
  reactionCounts: Record<EventUpdateReactionType, number>;
  myReaction: EventUpdateReactionType | null;
};

const createSchema = z.object({
  eventId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
  priority: z.enum(["normal", "high"]).optional()
});

/**
 * Reads the Updates for an Event the viewer may already open.
 *
 * Three queries regardless of how many Updates there are: the updates, their
 * authors, and every reaction on them. Counting reactions per update, or
 * fetching an author per row, is the shape this deliberately avoids.
 */
export async function listEventUpdates(
  eventId: string,
  viewerId: string
): Promise<EventUpdateView[]> {
  const access = await getEventForViewer(eventId, viewerId);
  if (!access.ok) return [];

  const admin = createSupabaseAdminClient();
  const { data: updates } = await admin
    .from("event_updates")
    .select("id, author_id, body, priority, edited_at, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!updates?.length) return [];

  const updateIds = updates.map((u) => u.id);
  const authorIds = [...new Set(updates.map((u) => u.author_id))];
  const [{ data: authors }, { data: reactions }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name").in("user_id", authorIds),
    admin
      .from("event_update_reactions")
      .select("event_update_id, user_id, reaction_type")
      .in("event_update_id", updateIds)
  ]);

  const nameById = new Map((authors ?? []).map((a) => [a.user_id, a.full_name]));
  const countsByUpdate = new Map<string, Record<string, number>>();
  const mineByUpdate = new Map<string, EventUpdateReactionType>();
  for (const row of reactions ?? []) {
    const counts = countsByUpdate.get(row.event_update_id) ?? {};
    counts[row.reaction_type] = (counts[row.reaction_type] ?? 0) + 1;
    countsByUpdate.set(row.event_update_id, counts);
    if (row.user_id === viewerId) {
      mineByUpdate.set(row.event_update_id, row.reaction_type as EventUpdateReactionType);
    }
  }

  return updates.map((update) => {
    const counts = countsByUpdate.get(update.id) ?? {};
    return {
      id: update.id,
      body: update.body,
      priority: update.priority as EventUpdatePriority,
      createdAt: update.created_at,
      editedAt: update.edited_at,
      authorName: nameById.get(update.author_id)?.trim() || "The host",
      reactionCounts: {
        heart: counts.heart ?? 0,
        fire: counts.fire ?? 0,
        applause: counts.applause ?? 0,
        wow: counts.wow ?? 0
      },
      myReaction: mineByUpdate.get(update.id) ?? null
    };
  });
}

/**
 * Publishes an Update. Host or Event admin only -- checked on the server,
 * because a hidden button is not an access control.
 *
 * Persisting and notifying are separated on purpose: the row is written here,
 * and a job fans out delivery. A publish must not block on thirty thousand
 * notification writes, and a fanout that fails later must not make the host
 * believe their Update never posted.
 */
export async function createEventUpdate(userId: string, input: unknown): Promise<UpdateResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Write an update before posting." };

  const access = await getEventForViewer(parsed.data.eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  if (!access.canManage) return { ok: false, message: "Only the host can post updates." };
  if (access.event.status === "cancelled") {
    return { ok: false, message: "This event was cancelled." };
  }

  const limit = await consumeRateLimit({ action: "events.update", userId });
  if (!limit.allowed) return { ok: false, message: rateLimitMessage(limit.resetAt) };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("event_updates")
    .insert({
      event_id: parsed.data.eventId,
      author_id: userId,
      body: parsed.data.body.trim(),
      priority: parsed.data.priority ?? "normal"
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "Couldn't post the update." };

  await enqueueUpdateFanout(admin, parsed.data.eventId, data.id);
  return { ok: true, message: "Update posted.", updateId: data.id };
}

/**
 * Queues delivery. One job per Update, keyed so a retry cannot produce a
 * second fanout -- the lesson the Plans dead-letter incident taught.
 */
async function enqueueUpdateFanout(admin: Admin, eventId: string, updateId: string): Promise<void> {
  await admin.from("jobs").insert({
    job_type: "events.update_fanout",
    payload: { eventId, updateId },
    idempotency_key: `event-update-fanout:${updateId}`,
    run_at: new Date().toISOString()
  });
}

/**
 * Edits an Update. Hosts make typos, and a noticeboard nobody can correct is
 * worse than one that admits it changed.
 *
 * Editing deliberately does NOT re-enqueue fanout: people already notified
 * must not be notified again because a word changed. `edited_at` lets the UI
 * say so instead.
 */
export async function editEventUpdate(
  userId: string,
  updateId: string,
  body: string
): Promise<UpdateResult> {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 2000) return { ok: false, message: "Write an update." };

  const admin = createSupabaseAdminClient();
  const { data: update } = await admin
    .from("event_updates")
    .select("id, event_id, author_id")
    .eq("id", updateId)
    .maybeSingle();
  if (!update) return { ok: false, message: "Update not found." };

  const access = await getEventForViewer(update.event_id, userId);
  if (!access.ok || !access.canManage) {
    return { ok: false, message: "Only the host can edit updates." };
  }

  const { error } = await admin
    .from("event_updates")
    .update({ body: trimmed, edited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", updateId);
  if (error) return { ok: false, message: "Couldn't save the update." };
  return { ok: true, message: "Update saved.", updateId };
}

/**
 * Sets, changes or clears the viewer reaction.
 *
 * One row per person per Update, enforced by the unique constraint, so a count
 * counts people rather than taps. Passing null removes it.
 */
export async function setUpdateReaction(
  userId: string,
  updateId: string,
  reaction: string | null
): Promise<UpdateResult> {
  if (reaction !== null && !REACTION_TYPES.includes(reaction as EventUpdateReactionType)) {
    return { ok: false, message: "Unknown reaction." };
  }

  const admin = createSupabaseAdminClient();
  const { data: update } = await admin
    .from("event_updates")
    .select("id, event_id")
    .eq("id", updateId)
    .maybeSingle();
  if (!update) return { ok: false, message: "Update not found." };

  // Reacting requires the same access as reading: an Update on a private Event
  // must not be reachable through the reaction endpoint.
  const access = await getEventForViewer(update.event_id, userId);
  if (!access.ok) return { ok: false, message: "Update not found." };

  if (reaction === null) {
    await admin
      .from("event_update_reactions")
      .delete()
      .eq("event_update_id", updateId)
      .eq("user_id", userId);
    return { ok: true, message: "Reaction removed." };
  }

  const { error } = await admin
    .from("event_update_reactions")
    .upsert(
      {
        event_update_id: updateId,
        user_id: userId,
        reaction_type: reaction as EventUpdateReactionType,
        updated_at: new Date().toISOString()
      },
      { onConflict: "event_update_id,user_id" }
    );
  if (error) return { ok: false, message: "Couldn't save your reaction." };
  return { ok: true, message: "Reaction saved." };
}

// ---------------------------------------------------------------------------
// Event admins
// ---------------------------------------------------------------------------

export type EventAdminView = { userId: string; name: string; addedAt: string };

export async function listEventAdmins(eventId: string, viewerId: string): Promise<EventAdminView[]> {
  const access = await getEventForViewer(eventId, viewerId);
  if (!access.ok || !access.canManage) return [];

  const admin = createSupabaseAdminClient();
  const { data: rows } = await admin
    .from("event_admins")
    .select("user_id, created_at")
    .eq("event_id", eventId);
  if (!rows?.length) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, full_name")
    .in(
      "user_id",
      rows.map((r) => r.user_id)
    );
  const nameById = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

  return rows.map((row) => ({
    userId: row.user_id,
    name: nameById.get(row.user_id)?.trim() || "A Muddy",
    addedAt: row.created_at
  }));
}

/**
 * Appointing admins is HOST ONLY, deliberately.
 *
 * An admin who could appoint admins is an owner by another name: they could
 * add an ally, and between them hold the Event regardless of what the host
 * wanted. Delegation goes one level and stops.
 */
export async function addEventAdmin(
  userId: string,
  eventId: string,
  targetUserId: string
): Promise<UpdateResult> {
  const access = await getEventForViewer(eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  if (!isEventOwner({ hostId: access.event.host_id }, userId)) {
    return { ok: false, message: "Only the host can add event admins." };
  }
  if (targetUserId === access.event.host_id) {
    // The host already holds every permission; a row would be a second source
    // of truth for ownership.
    return { ok: false, message: "You already manage this event." };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("event_admins")
    .upsert({ event_id: eventId, user_id: targetUserId }, { onConflict: "event_id,user_id" });
  if (error) return { ok: false, message: "Couldn't add that admin." };
  return { ok: true, message: "Event admin added." };
}

export async function removeEventAdmin(
  userId: string,
  eventId: string,
  targetUserId: string
): Promise<UpdateResult> {
  const access = await getEventForViewer(eventId, userId);
  if (!access.ok) return { ok: false, message: "Event not found." };
  if (!isEventOwner({ hostId: access.event.host_id }, userId)) {
    return { ok: false, message: "Only the host can remove event admins." };
  }

  const admin = createSupabaseAdminClient();
  await admin.from("event_admins").delete().eq("event_id", eventId).eq("user_id", targetUserId);
  return { ok: true, message: "Event admin removed." };
}

/** Whether this viewer may publish for the Event. Used by the composer gate. */
export async function canPublishEventUpdate(eventId: string, viewerId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("host_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return false;
  if (event.host_id === viewerId) return true;
  return viewerIsEventAdmin(admin, eventId, viewerId);
}
