"use server";

import { z } from "zod";
import { buildSafeNearbyFriends, type NearbyLocationRow, type NearbyProfileRow } from "@/lib/proximity/backend";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import {
  AREA_TIER_PROXIMITY,
  isSocializeActivity,
  isSocializeAreaTier,
  type SocializeActivity,
  type SocializeAreaTier
} from "@/lib/social/socialize";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";

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
  proximityTier: Extract<ProximityLevel, "very_close" | "nearby" | "around">;
  waveState: SocializeWaveState;
};

export type SocializeActionState = { ok: boolean; message: string; session?: SocializeSession };

const DURATION_MS: Record<string, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000
};

const socializeInputSchema = z.object({
  activity: z.string().refine(isSocializeActivity, "Choose an activity."),
  areaTier: z.string().refine(isSocializeAreaTier, "Choose an area."),
  duration: z.enum(["30m", "1h", "3h"]),
  note: z.string().trim().max(140).optional()
});

function envMissing(): boolean {
  const env = getSupabaseServerEnv();
  return !env.url || !env.serviceRoleKey;
}

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
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

/** The caller's current active, unexpired session (or null). Guarded so a
 * deploy that precedes the migration returns null rather than throwing. */
export async function getCurrentSocializeAction(): Promise<SocializeSession | null> {
  if (envMissing()) return null;
  const userId = await getAuthedUserId();
  if (!userId) return null;

  try {
    const admin = createSupabaseAdminClient();
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

export async function activateSocializeAction(input: unknown): Promise<SocializeActionState> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = socializeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const rate = await consumeRateLimit({ action: "hangouts.start", userId });
  if (!rate.allowed) return { ok: false, message: rateLimitMessage(rate.resetAt) };

  const now = Date.now();
  const expiresAt = new Date(now + (DURATION_MS[parsed.data.duration] ?? DURATION_MS["1h"])).toISOString();

  try {
    const admin = createSupabaseAdminClient();
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
        activity: parsed.data.activity,
        note: parsed.data.note?.trim() || null,
        area_tier: parsed.data.areaTier,
        starts_at: new Date(now).toISOString(),
        expires_at: expiresAt,
        status: "active"
      })
      .select("id, activity, note, area_tier, starts_at, expires_at, status")
      .single();
    if (error || !data) return { ok: false, message: "Couldn’t turn on Socialize. Try again." };
    return { ok: true, message: "Socialize is on", session: toSession(data) };
  } catch {
    return { ok: false, message: "Couldn’t turn on Socialize. Try again." };
  }
}

export async function updateSocializeAction(input: unknown): Promise<SocializeActionState> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  const parsed = socializeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const expiresAt = new Date(Date.now() + (DURATION_MS[parsed.data.duration] ?? DURATION_MS["1h"])).toISOString();

  try {
    const admin = createSupabaseAdminClient();
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

export async function deactivateSocializeAction(): Promise<SocializeActionState> {
  if (envMissing()) return { ok: false, message: "This action needs the server database configuration." };
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  try {
    const admin = createSupabaseAdminClient();
    await admin
      .from("socialize_sessions")
      .update({ status: "ended", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "active");
    return { ok: true, message: "Socialize is off" };
  } catch {
    return { ok: false, message: "Couldn’t turn off Socialize. Try again." };
  }
}

const PROXIMITY_RANK: Record<string, number> = { very_close: 0, nearby: 1, around: 2 };

/**
 * Privacy-safe discovery of other people currently using Socialize. Reuses the
 * exact nearby proximity engine (buildSafeNearbyFriends): coordinates never
 * leave the server, only broad tiers do. Filters by the caller's area tier,
 * blocking (either direction), Ghost Mode and existing-Muddy status.
 */
export async function discoverSocializePeopleAction(): Promise<SocializePerson[]> {
  if (envMissing()) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];

  try {
    const admin = createSupabaseAdminClient();

    // My own active session decides my area tier; without one there is nothing
    // to discover (opt-in only).
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

    const [{ data: blocks }, { data: friendships }, { data: locations }, { data: profiles }] = await Promise.all([
      admin
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`),
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`),
      admin
        .from("user_locations")
        .select("user_id, latitude, longitude, confidence, last_updated")
        .in("user_id", candidateIds),
      admin
        .from("profiles")
        .select("user_id, full_name, username, avatar_url, visibility_status")
        .in("user_id", candidateIds)
    ]);

    const blockedIds = new Set((blocks ?? []).flatMap((block) => [block.blocker_id, block.blocked_id]));
    // Existing Muddies are already connected: Socialize is for new people.
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

    const eligibleIds = candidateIds.filter((id) => !blockedIds.has(id) && !friendIds.has(id));
    if (eligibleIds.length === 0) return [];

    const safe = buildSafeNearbyFriends({
      viewer: viewerLocation as { latitude: number; longitude: number; confidence: ConfidenceLevel },
      friendIds: eligibleIds,
      blockedIds,
      premiumUserIds: new Set(),
      locationByUserId,
      profileByUserId
    });

    // My outstanding requests to / from these people, to reflect wave state.
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

    const people: SocializePerson[] = [];
    for (const candidate of safe) {
      const tier = candidate.proximity_level;
      if (tier !== "very_close" && tier !== "nearby" && tier !== "around") continue;
      if (!allowedTiers.includes(tier)) continue;
      const session = sessionByUserId.get(candidate.friend_id);
      if (!session) continue;
      people.push({
        userId: candidate.friend_id,
        displayName: candidate.display_name,
        username: candidate.username,
        avatarUrl: candidate.avatar_url,
        activity: session.activity as SocializeActivity,
        note: session.note,
        proximityTier: tier,
        waveState: sentTo.has(candidate.friend_id)
          ? "sent"
          : receivedFrom.has(candidate.friend_id)
            ? "received"
            : "none"
      });
    }

    // Sort: proximity tier, then most recently activated, then display name.
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
