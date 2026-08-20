import "server-only";

import { eventModeCandidateIds } from "@/lib/linkr/event-mode-adapter";
import { compatibleIntentsFor, isLinkrIntent, type LinkrIntent } from "@/lib/linkr/intent";
import {
  DISTANCE_TIERS,
  isCandidateEligible,
  proximityLabel,
  rankCandidate,
  resolveDiscoverability,
  type LinkrDistancePreference,
  type LinkrProximityTier
} from "@/lib/linkr/rules";
import { resolveAges, signMediaUrls } from "@/lib/linkr/profile-service";
import { loadLinkrMedia } from "@/lib/linkr/media-projection";
import { presenceStateFor } from "@/lib/presence/freshness";
import {
  buildSafeNearbyFriends,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ConfidenceLevel } from "@/lib/proximity";
import { getSupabaseServerEnv } from "@/lib/supabase/env";

/**
 * THE CANDIDATE AUTHORITY. The server decides who may be seen; the client
 * receives a finished, already-filtered list and does no filtering of its own.
 *
 * Two properties this file is responsible for:
 *
 *  1. ELIGIBILITY BEFORE RANKING. Every privacy rule is applied while building
 *     the set; the score only orders what survived. A high-scoring blocked
 *     user is not "sorted last", they are never in the array.
 *
 *  2. NO N+1, AND NO BULK DOWNLOAD. One query per KIND of fact -- profiles,
 *     ages, photos, blocks, actions, locations, interests -- each `.in()` over
 *     the whole candidate batch. The batch is bounded (CANDIDATE_BATCH_SIZE),
 *     so the work per request has a ceiling regardless of how many people use
 *     Linkr.
 *
 * WHAT NEVER CROSSES THE WIRE: coordinates, metres, a distance, a last-seen
 * timestamp, or anyone's presence in a specific place. A candidate carries a
 * coarse tier label and nothing from which one could be reconstructed.
 */

/**
 * How many people are considered per request.
 *
 * Bounded on purpose. Ranking is O(n) over this number and runs inside a
 * Vercel request, so the cost of a discovery load is fixed rather than
 * proportional to the size of the user base.
 */
export const CANDIDATE_BATCH_SIZE = 60;

/** How long a returned deck is worth before the client asks again. */
export const CANDIDATE_PAGE_SIZE = 20;

export type LinkrCandidate = {
  userId: string;
  displayName: string;
  age: number | null;
  intent: LinkrIntent;
  bio: string | null;
  interests: string[];
  photos: string[];
  /** A coarse label such as "Very close". Never a distance. */
  proximityLabel: string;
  activeNow: boolean;
  isVerifiedAccount: boolean;
  /** Present only in Event Mode, and only as a name. */
  eventName: string | null;
};

function serverReady(): boolean {
  const env = getSupabaseServerEnv();
  return Boolean(env.url && env.serviceRoleKey);
}

export type DiscoverOptions = {
  /** Present when the viewer is browsing an Event, already authorised upstream. */
  eventId?: string | null;
  eventName?: string | null;
  /** Overrides the stored preference for this request only (the Widen button). */
  distanceOverride?: LinkrDistancePreference | null;
  limit?: number;
};

/**
 * The discovery query.
 *
 * Returns [] for every "we cannot safely answer" case rather than throwing:
 * no Linkr profile, Linkr off, no location, no candidates. An empty deck is a
 * legitimate product state with its own screen, and it is also the correct
 * fail-closed answer.
 */
export async function discoverLinkrCandidates(
  viewerId: string,
  options: DiscoverOptions = {}
): Promise<LinkrCandidate[]> {
  if (!serverReady()) return [];
  const admin = createSupabaseAdminClient();
  const nowMs = Date.now();

  // --- The viewer's own state. Nothing proceeds without it. ----------------
  const { data: viewer } = await admin
    .from("linkr_profiles")
    .select("enabled, intent, discovery_distance, require_photos, only_active_now, only_new_today")
    .eq("user_id", viewerId)
    .maybeSingle();
  // Linkr off means you neither appear nor browse. Discovery is reciprocal by
  // design: browsing while invisible is exactly the asymmetry this product
  // exists to avoid.
  if (!viewer?.enabled) return [];

  const viewerAge = (await resolveAges(admin, [viewerId])).get(viewerId) ?? null;
  if (viewerAge === null || viewerAge < 18) return [];

  const viewerIntent: LinkrIntent = isLinkrIntent(viewer.intent) ? viewer.intent : "friends";
  const distance = (options.distanceOverride ??
    (viewer.discovery_distance as LinkrDistancePreference) ??
    "around_you") as LinkrDistancePreference;
  const allowedTiers = DISTANCE_TIERS[distance] ?? DISTANCE_TIERS.around_you;
  const compatibleIntents = new Set(compatibleIntentsFor(viewerIntent));

  const { data: viewerLocation } = await admin
    .from("user_locations")
    // last_updated is required by the proximity engine, which holds the viewer
    // to the same freshness rule as everyone else.
    .select("latitude, longitude, confidence, last_updated")
    .eq("user_id", viewerId)
    .maybeSingle();
  if (!viewerLocation) return [];

  // --- The candidate pool. -------------------------------------------------
  //
  // Narrowed at the database wherever a column allows it: enabled Linkr
  // profiles, compatible intent, not the viewer. Everything a column cannot
  // decide -- blocks, age, proximity, action history -- is applied below,
  // over a bounded batch.
  const eventMode = Boolean(options.eventId);
  let eventAttendeeIds: Set<string> | null = null;
  if (eventMode && options.eventId) {
    // Events decides who is checked in and consenting. Linkr only intersects.
    eventAttendeeIds = await eventModeCandidateIds(admin, viewerId, options.eventId);
    if (eventAttendeeIds.size === 0) return [];
  }

  let poolQuery = admin
    .from("linkr_profiles")
    .select("user_id, intent, bio, event_mode_enabled, created_at")
    .eq("enabled", true)
    .neq("user_id", viewerId)
    .in("intent", [...compatibleIntents])
    .limit(CANDIDATE_BATCH_SIZE);
  if (eventAttendeeIds) {
    poolQuery = poolQuery.in("user_id", [...eventAttendeeIds]);
  }

  const { data: pool } = await poolQuery;
  if (!pool?.length) return [];

  const candidateIds = pool.map((row) => row.user_id);

  // --- One query per kind of fact, each batched over the whole pool. -------
  const [
    { data: blocks },
    { data: profiles },
    { data: locations },
    { data: actions },
    { data: connections },
    photosByUser,
    { data: interestRows },
    { data: verifications },
    ages,
    viewerInterestRows
  ] = await Promise.all([
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url, visibility_status, deleted_at")
      .in("user_id", candidateIds),
    admin
      .from("user_locations")
      .select("user_id, latitude, longitude, confidence, last_updated")
      .in("user_id", candidateIds),
    // Everything this viewer already decided about. A pass with a past
    // expires_at is filtered here rather than trusted to a cleanup job.
    admin
      .from("linkr_actions")
      .select("target_id, action, expires_at")
      .eq("actor_id", viewerId)
      .in("target_id", candidateIds),
    admin
      .from("linkr_connections")
      .select("user_low, user_high")
      .is("ended_at", null)
      .or(`user_low.eq.${viewerId},user_high.eq.${viewerId}`),
    // Canonical Profile media, projected stranger-safe. Batched over the whole
    // candidate page, so adding photos to the card costs no extra round trip
    // per person.
    loadLinkrMedia(admin, candidateIds),
    admin.from("linkr_interests").select("user_id, interest").in("user_id", candidateIds),
    admin.from("account_verifications").select("user_id, status").in("user_id", candidateIds),
    resolveAges(admin, candidateIds),
    admin.from("linkr_interests").select("interest").eq("user_id", viewerId)
  ]);

  const blockedIds = new Set(
    (blocks ?? []).flatMap((block) => [block.blocker_id, block.blocked_id])
  );
  const connectedIds = new Set(
    (connections ?? []).map((row) => (row.user_low === viewerId ? row.user_high : row.user_low))
  );
  const actedOnIds = new Set(
    (actions ?? [])
      .filter((row) => !row.expires_at || Date.parse(row.expires_at) > nowMs)
      .map((row) => row.target_id)
  );

  const profileByUserId = new Map(
    ((profiles ?? []) as NearbyProfileRow[]).map((profile) => [profile.user_id, profile])
  );
  const locationByUserId = new Map(
    ((locations ?? []) as NearbyLocationRow[]).map((location) => [location.user_id, location])
  );
  const verifiedIds = new Set(
    (verifications ?? []).filter((row) => row.status === "verified").map((row) => row.user_id)
  );

  const interestsByUser = new Map<string, string[]>();
  for (const row of interestRows ?? []) {
    const list = interestsByUser.get(row.user_id) ?? [];
    list.push(row.interest);
    interestsByUser.set(row.user_id, list);
  }
  const viewerInterests = new Set(
    ((viewerInterestRows.data ?? []) as Array<{ interest: string }>).map((row) => row.interest)
  );

  // --- Proximity, from the canonical engine. -------------------------------
  //
  // Composed, not reimplemented: no Haversine, no thresholds and no
  // confidence handling live in Linkr. The engine returns coarse tiers, which
  // is the only geographic fact this file ever handles.
  const safe = buildSafeNearbyFriends({
    viewer: viewerLocation as {
      latitude: number;
      longitude: number;
      confidence: ConfidenceLevel;
      last_updated: string;
    },
    friendIds: candidateIds,
    blockedIds,
    premiumUserIds: new Set(),
    locationByUserId,
    profileByUserId,
    now: nowMs
  });
  const tierByUserId = new Map(safe.map((row) => [row.friend_id, row.proximity_level]));

  const poolByUserId = new Map(pool.map((row) => [row.user_id, row]));
  const dayAgoMs = nowMs - 24 * 60 * 60 * 1000;

  // --- Eligibility, then ranking. -----------------------------------------
  const scored: Array<{ candidate: LinkrCandidate; score: number; assetIds: string[] }> = [];

  for (const id of candidateIds) {
    const row = poolByUserId.get(id);
    const profile = profileByUserId.get(id) as
      | (NearbyProfileRow & { deleted_at?: string | null })
      | undefined;
    if (!row || !profile) continue;

    const tier = tierByUserId.get(id);
    if (tier !== "close" && tier !== "near" && tier !== "far") continue;

    /**
     * Canonical Profile media, already ordered: the profile picture at index 0
     * and the stranger-safe showcase photos after it. Index 0 existing IS
     * "has a profile picture" -- the projection omits everything for anybody
     * without one, so Linkr never has to define its own idea of having a photo.
     */
    const photos = photosByUser.get(id) ?? [];
    const age = ages.get(id) ?? null;
    const location = locationByUserId.get(id);
    const presence = presenceStateFor(location?.last_updated ?? null, nowMs);
    const candidateIntent: LinkrIntent = isLinkrIntent(row.intent) ? row.intent : "friends";

    const discoverability = resolveDiscoverability({
      linkrEnabled: true,
      age,
      hasPrimaryPhoto: photos.length > 0,
      accountVisible: profile.visibility_status !== "ghost",
      restricted: false,
      deleted: Boolean(profile.deleted_at)
    });

    const verdict = isCandidateEligible({
      isSelf: id === viewerId,
      blockedEitherDirection: blockedIds.has(id),
      candidateDiscoverable: discoverability.discoverable,
      viewerIntent,
      candidateIntent,
      tier: tier as LinkrProximityTier,
      allowedTiers,
      alreadyActedOn: actedOnIds.has(id),
      alreadyConnected: connectedIds.has(id),
      presenceExpired: presence === "expired",
      requirePhotos: Boolean(viewer.require_photos),
      candidateHasShowcasePhotos: photos.length > 1,
      onlyActiveNow: Boolean(viewer.only_active_now),
      candidateActiveNow: presence === "fresh",
      onlyNewToday: Boolean(viewer.only_new_today),
      candidateJoinedToday: Date.parse(row.created_at) > dayAgoMs,
      // In Event Mode the viewer must also honour their own user-level
      // permission: someone who turned Event Mode off is not shown to
      // attendees even though the Event side consented them.
      eventModeActive: eventMode,
      eventEligible: eventMode
        ? Boolean(eventAttendeeIds?.has(id)) && row.event_mode_enabled !== false
        : true
    });
    if (!verdict.eligible) continue;

    const interests = interestsByUser.get(id) ?? [];
    const shared = interests.filter((interest) => viewerInterests.has(interest)).length;

    scored.push({
      assetIds: photos,
      score: rankCandidate({
        tier: tier as LinkrProximityTier,
        sharedInterests: shared,
        intentExactMatch: candidateIntent === viewerIntent,
        photoCount: photos.length,
        hasBio: Boolean(row.bio),
        activeNow: presence === "fresh",
        joinedRecently: Date.parse(row.created_at) > dayAgoMs
      }),
      candidate: {
        userId: id,
        displayName: profile.full_name?.trim() || profile.username || "Someone",
        age,
        intent: candidateIntent,
        bio: row.bio ?? null,
        interests,
        photos: [],
        proximityLabel: proximityLabel(tier as LinkrProximityTier, eventMode),
        activeNow: presence === "fresh",
        isVerifiedAccount: verifiedIds.has(id),
        eventName: eventMode ? options.eventName ?? null : null
      }
    });
  }

  scored.sort((a, b) => b.score - a.score || a.candidate.userId.localeCompare(b.candidate.userId));
  const page = scored.slice(0, options.limit ?? CANDIDATE_PAGE_SIZE);

  // Photos are signed LAST, for the page only. Signing the whole batch would
  // mint URLs for people the viewer will never be shown.
  const urls = await signMediaUrls(admin, page.flatMap((entry) => entry.assetIds));
  return page.map((entry) => ({
    ...entry.candidate,
    photos: entry.assetIds.map((assetId) => urls.get(assetId)).filter((url): url is string => Boolean(url))
  }));
}

/**
 * How many people are open to connecting at an Event.
 *
 * Returns a COUNT, which the caller passes to the Events describer for the
 * small-pool rule. Linkr never renders this number directly.
 */
export async function countEventPool(viewerId: string, eventId: string): Promise<number> {
  if (!serverReady()) return 0;
  const admin = createSupabaseAdminClient();
  const ids = await eventModeCandidateIds(admin, viewerId, eventId);
  return ids.size;
}
