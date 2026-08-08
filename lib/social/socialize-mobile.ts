import "server-only";

import { z } from "zod";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { buildSafeNearbyFriends, type NearbyLocationRow, type NearbyProfileRow } from "@/lib/proximity/backend";
import { presenceStateFor, type PresenceState } from "@/lib/presence/freshness";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  AREA_TIER_PROXIMITY,
  isSocializeActivity,
  isSocializeAreaTier,
  type SocializeActivity,
  type SocializeAreaTier
} from "@/lib/social/socialize";
import { approximateDistanceLabel } from "@/lib/proximity/approximate-distance";
import { haversineMeters, weakerConfidence } from "@/lib/proximity/backend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { isSocializeEnabled } from "@/lib/features/feature-flags";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Transport-agnostic Socialize logic. Takes an already-authenticated `userId`;
 * shared by the web Server Actions (socialize-actions.ts, thin wrappers) and the
 * mobile /api/socialize routes. "Waving" at a discovered person is a friend
 * request, so the wave action reuses the existing /api/friends/request.
 */

export type SocializeSession = {
  id: string;
  activity: SocializeActivity;
  note: string | null;
  areaTier: SocializeAreaTier;
  startsAt: string;
  expiresAt: string;
  status: "active" | "ended" | "expired";
};

export type SocializeWaveState = "none" | "sent" | "received" | "accepted";

export type SocializePerson = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  activity: SocializeActivity;
  note: string | null;
  proximityTier: Extract<ProximityLevel, "close" | "near" | "far">;
  /**
   * How recently this person's device reported in — SERVER-derived, and a
   * classification rather than a timestamp, so no exact last-seen time or
   * update cadence leaves the server.
   */
  presenceState: PresenceState;
  /**
   * When their location was last recorded. Internal to authorised Socialize
   * data and used only to re-evaluate presence as time passes on the client;
   * never rendered.
   */
  lastPresenceUpdate: string | null;
  waveState: SocializeWaveState;
  plan: SubscriptionPlan;
  /**
   * A rounded, display-ready distance such as "≈ 3 km away", or null when it
   * cannot be shown.
   *
   * Already a string, by design: no numeric distance ever reaches a client, so
   * there is nothing for a caller to re-derive, compare precisely, or
   * trilaterate with.
   */
  approxDistance: string | null;
};

export type SocializeActionResult = { ok: boolean; message: string; session?: SocializeSession };

const DURATION_MS: Record<string, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000
};

// Socialize is spontaneous: only duration + range are required. `activity` and
// `note` stay optional so older callers (and the mobile API) keep working, but
// the radar UI never asks for them — activity defaults to "anything".
export const socializeInputSchema = z.object({
  activity: z.string().refine(isSocializeActivity, "Choose an activity.").optional(),
  areaTier: z.string().refine(isSocializeAreaTier, "Choose an area."),
  duration: z.enum(["30m", "1h", "3h"]),
  note: z.string().trim().max(140).optional()
});

const DEFAULT_SOCIALIZE_ACTIVITY: SocializeActivity = "anything";

function envMissing(): boolean {
  const env = getSupabaseServerEnv();
  return !env.url || !env.serviceRoleKey;
}

function toSession(row: {
  id: string;
  activity: string;
  note: string | null;
  area_tier: string;
  starts_at: string;
  expires_at: string;
  status: string;
}): SocializeSession {
  return {
    id: row.id,
    activity: row.activity as SocializeActivity,
    note: row.note,
    areaTier: row.area_tier as SocializeAreaTier,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    status: row.status as SocializeSession["status"]
  };
}

export async function getCurrentSocialize(userId: string): Promise<SocializeSession | null> {
  if (envMissing()) return null;
  try {
    const admin = createSupabaseAdminClient();
    if (!(await isSocializeEnabled(admin))) return null;
    const { data } = await admin
      .from("socialize_sessions")
      .select("id, activity, note, area_tier, starts_at, expires_at, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? toSession(data) : null;
  } catch {
    return null;
  }
}

export async function activateSocialize(userId: string, input: unknown): Promise<SocializeActionResult> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = socializeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const rate = await consumeRateLimit({ action: "hangouts.start", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const now = Date.now();
  const expiresAt = new Date(now + (DURATION_MS[parsed.data.duration] ?? DURATION_MS["1h"])).toISOString();

  try {
    const admin = createSupabaseAdminClient();
    if (!(await isSocializeEnabled(admin))) {
      return { ok: false, message: "Socialize is not available right now." };
    }
    // One active session per user: end any existing active one first.
    await admin
      .from("socialize_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");

    const { data, error } = await admin
      .from("socialize_sessions")
      .insert({
        user_id: userId,
        activity: parsed.data.activity ?? DEFAULT_SOCIALIZE_ACTIVITY,
        note: parsed.data.note?.trim() || null,
        area_tier: parsed.data.areaTier,
        starts_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        status: "active"
      })
      .select("id, activity, note, area_tier, starts_at, expires_at, status")
      .single();
    if (error || !data) return { ok: false, message: "Couldn’t turn on Socialize. Try again." };
    {
      const { grantAchievement } = await import("@/lib/engagement/achievements");
      await grantAchievement(admin, userId, "open_to_plans");
    }
    return { ok: true, message: "Socialize is on", session: toSession(data) };
  } catch {
    return { ok: false, message: "Couldn’t turn on Socialize. Try again." };
  }
}

export async function updateSocialize(userId: string, input: unknown): Promise<SocializeActionResult> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = socializeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }

  const expiresAt = new Date(Date.now() + (DURATION_MS[parsed.data.duration] ?? DURATION_MS["1h"])).toISOString();

  try {
    const admin = createSupabaseAdminClient();
    if (!(await isSocializeEnabled(admin))) {
      return { ok: false, message: "Socialize is not available right now." };
    }
    const { data, error } = await admin
      .from("socialize_sessions")
      .update({
        activity: parsed.data.activity,
        note: parsed.data.note?.trim() || null,
        area_tier: parsed.data.areaTier,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .eq("status", "active")
      .select("id, activity, note, area_tier, starts_at, expires_at, status")
      .maybeSingle();
    if (error || !data) return { ok: false, message: "Couldn’t update Socialize. Try again." };
    return { ok: true, message: "Socialize updated", session: toSession(data) };
  } catch {
    return { ok: false, message: "Couldn’t update Socialize. Try again." };
  }
}

export async function deactivateSocialize(userId: string): Promise<SocializeActionResult> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("socialize_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");
    return { ok: true, message: "Linkr is off" };
  } catch {
    return { ok: false, message: "Couldn’t turn off Socialize. Try again." };
  }
}

const PROXIMITY_RANK: Record<string, number> = { close: 0, near: 1, far: 2 };

/**
 * Privacy-safe discovery of other people currently using Socialize. Reuses the
 * nearby proximity engine (buildSafeNearbyFriends): coordinates never leave the
 * server, only broad tiers do. Filters by area tier, blocks, Ghost Mode, and
 * existing-Muddy status.
 */
export async function discoverSocializePeople(userId: string): Promise<SocializePerson[]> {
  if (envMissing()) return [];
  try {
    const admin = createSupabaseAdminClient();
    if (!(await isSocializeEnabled(admin))) return [];

    const { data: mySession } = await admin
      .from("socialize_sessions")
      .select("area_tier")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!mySession) return [];
    const allowedTiers = AREA_TIER_PROXIMITY[mySession.area_tier as SocializeAreaTier] ?? [];

    const { data: viewerLocation } = await admin
      .from("user_locations")
      .select("latitude, longitude, confidence")
      .eq("user_id", userId)
      .maybeSingle();
    if (!viewerLocation) return [];

    const nowIso = new Date().toISOString();
    const { data: sessions } = await admin
      .from("socialize_sessions")
      .select("user_id, activity, note, starts_at")
      .neq("user_id", userId)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(200);
    if (!sessions?.length) return [];

    const candidateIds = [...new Set(sessions.map((session) => session.user_id))];

    const [
      { data: blocks },
      { data: friendships },
      { data: locations },
      { data: profiles },
      { data: passes }
    ] = await Promise.all([
      admin.from("blocked_users").select("blocker_id, blocked_id").or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        // Active friendships only: ended_at IS NULL is the canonical definition of "currently Muddies".
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`).is("ended_at", null),
      admin
        .from("user_locations")
        .select("user_id, latitude, longitude, confidence, last_updated")
        .in("user_id", candidateIds),
      admin
        .from("profiles")
        .select("user_id, full_name, username, avatar_url, visibility_status")
        .in("user_id", candidateIds),
      // People this viewer passed on in the deck. Filtered by expires_at
      // rather than trusting a cleanup job: an expired pass stops applying
      // whether or not anything ever deletes the row.
      admin
        .from("discovery_passes")
        .select("passed_user_id")
        .eq("user_id", userId)
        .gt("expires_at", nowIso)
        .in("passed_user_id", candidateIds)
    ]);

    const blockedIds = new Set((blocks ?? []).flatMap((block) => [block.blocker_id, block.blocked_id]));
    const friendIds = new Set(
      (friendships ?? []).map((row) => (row.user_one_id === userId ? row.user_two_id : row.user_one_id))
    );

    const locationByUserId = new Map(
      ((locations ?? []) as NearbyLocationRow[]).map((location) => [location.user_id, location])
    );
    const profileByUserId = new Map(
      ((profiles ?? []) as NearbyProfileRow[]).map((profile) => [profile.user_id, profile])
    );
    const sessionByUserId = new Map(sessions.map((session) => [session.user_id, session]));

    // A pass is a private feed preference, so it excludes exactly like a block
    // does — but only for THIS viewer, and only until it expires.
    const passedIds = new Set((passes ?? []).map((pass) => pass.passed_user_id));

    const eligibleIds = candidateIds.filter(
      (id) => !blockedIds.has(id) && !friendIds.has(id) && !passedIds.has(id)
    );
    if (eligibleIds.length === 0) return [];

    const safe = buildSafeNearbyFriends({
      viewer: viewerLocation as { latitude: number; longitude: number; confidence: ConfidenceLevel },
      friendIds: eligibleIds,
      blockedIds,
      premiumUserIds: new Set(),
      locationByUserId,
      profileByUserId
    });

    const { data: requests } = await admin
      .from("friend_requests")
      .select("sender_id, receiver_id, status")
      .eq("status", "pending")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
    const sentTo = new Set(
      (requests ?? []).filter((request) => request.sender_id === userId).map((request) => request.receiver_id)
    );
    const receivedFrom = new Set(
      (requests ?? []).filter((request) => request.receiver_id === userId).map((request) => request.sender_id)
    );
    const plans = await loadEffectivePlansForUsers(admin, safe.map((candidate) => candidate.friend_id));

    const people: SocializePerson[] = [];
    for (const candidate of safe) {
      const tier = candidate.proximity_level;
      if (tier !== "close" && tier !== "near" && tier !== "far") continue;
      if (!allowedTiers.includes(tier)) continue;
      const session = sessionByUserId.get(candidate.friend_id);
      if (!session) continue;
      // Someone whose device stopped reporting is not shown as nearby, even
      // though their Socialize session has not expired. Session expiry says
      // what they intended; presence says what we actually know.
      const locationRow = locationByUserId.get(candidate.friend_id);
      const lastPresenceUpdate = locationRow?.last_updated ?? null;
      const presenceState = presenceStateFor(lastPresenceUpdate, Date.parse(nowIso));
      if (presenceState === "expired") continue;

      /**
       * Approximate distance, bucketed HERE and emitted as a finished label.
       *
       * The metres exist only inside this loop: they are computed from the two
       * coordinate rows already in scope, converted immediately, and never
       * stored or returned. What crosses the wire is a string like
       * "≈ 3 km away", which carries no more information than it displays.
       *
       * This is deliberately not added to `SafeNearbyFriend` — that shape
       * feeds /api/friends/nearby, which has a guard rejecting any
       * location-adjacent response key, and that guard stays exactly as it is.
       */
      const approxDistance = locationRow
        ? approximateDistanceLabel(
            haversineMeters(viewerLocation as { latitude: number; longitude: number }, locationRow),
            weakerConfidence(
              (viewerLocation as { confidence: ConfidenceLevel }).confidence,
              locationRow.confidence
            )
          )
        : null;

      people.push({
        userId: candidate.friend_id,
        presenceState,
        lastPresenceUpdate,
        approxDistance,
        displayName: candidate.display_name,
        username: candidate.username,
        avatarUrl: candidate.avatar_url,
        activity: session.activity as SocializeActivity,
        note: session.note,
        plan: plans.get(candidate.friend_id) ?? "free",
        proximityTier: tier,
        waveState: sentTo.has(candidate.friend_id)
          ? "sent"
          : receivedFrom.has(candidate.friend_id)
            ? "received"
            : "none"
      });
    }

    people.sort((a, b) => {
      const tierDiff = PROXIMITY_RANK[a.proximityTier] - PROXIMITY_RANK[b.proximityTier];
      if (tierDiff !== 0) return tierDiff;
      const aStart = Date.parse(sessionByUserId.get(a.userId)?.starts_at ?? "");
      const bStart = Date.parse(sessionByUserId.get(b.userId)?.starts_at ?? "");
      if (aStart !== bStart) return bStart - aStart;
      return a.displayName.localeCompare(b.displayName);
    });

    return people;
  } catch {
    return [];
  }
}
