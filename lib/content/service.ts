import "server-only";

import { rankSpotlightMoments, resolveMomentVisibility } from "@/lib/content/moments";
import { isOpenMomentsEnabled } from "@/lib/features/feature-flags";
import { loadNearbyForUser } from "@/lib/proximity/nearby-service";
import { isCloseFriend, viewerCircleIds } from "@/lib/social/permissions";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { MediaVariantType, ReportableContentType } from "@/lib/supabase/database.types";

/**
 * Content server service (feature architecture batch 6). Resolves Moment
 * audiences and mints signed media URLs. Every decision routes through the
 * pure rules in lib/content/moments.ts; this layer only supplies facts.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Signed read URLs are short-lived by design (spec §41, §42). */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

/**
 * Mints a short-lived signed URL for a media asset. The caller MUST have
 * already authorized the viewer against the parent object, this function
 * deliberately does not know about parents, so it never becomes a way to read
 * arbitrary media by id.
 */
export async function signMediaUrl(
  admin: Admin,
  storageKey: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const { data, error } = await admin.storage.from("media").createSignedUrl(storageKey, ttlSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Prefers a processed variant; falls back to the original asset key. */
export async function signMediaForAsset(
  admin: Admin,
  mediaId: string,
  variant: MediaVariantType = "feed"
): Promise<string | null> {
  const { data: asset } = await admin
    .from("media_assets")
    .select("storage_key, moderation_status, deleted_at")
    .eq("id", mediaId)
    .maybeSingle();
  if (!asset || asset.deleted_at) return null;
  // Removed/restricted media is never served, whatever the parent says.
  if (asset.moderation_status === "removed" || asset.moderation_status === "restricted") return null;

  const { data: variantRow } = await admin
    .from("media_variants")
    .select("storage_key")
    .eq("media_asset_id", mediaId)
    .eq("variant_type", variant)
    .maybeSingle();

  return signMediaUrl(admin, variantRow?.storage_key ?? asset.storage_key);
}

export type VisibleMoment = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  contentType: "text" | "photo" | "video";
  textContent: string | null;
  caption: string | null;
  mediaUrl: string | null;
  expiresAt: string;
  createdAt: string;
  myReaction: string | null;
  /** Total reactions on this Moment (aggregate only — never who reacted). */
  reactionCount: number;
  /**
   * Count per reaction type, for the compact aggregate display. Still an
   * aggregate: it says five people used 🔥, never which five.
   */
  reactionBreakdown: Record<string, number>;
  isAuthor: boolean;
  /** Author-only: what audience this went to (spec §9). */
  audienceLabel: string | null;
  /**
   * Author-only reach. Null for everyone else: a Spotlight viewer must not be
   * able to read how many people saw someone else's Moment, and never who.
   */
  viewCount: number | null;
  /**
   * Author-only: how many people tuned in to the author BECAUSE of this Moment.
   * A count, never identities.
   */
  tunedInFromThis: number | null;
  /** Whether the VIEWER has tuned in to this creator. Their own state only. */
  creatorTunedIn: boolean;
  /** The creator's public aggregate. Never a list. */
  creatorTunedInCount: number;
};

/**
 * Builds the viewer's visible Moment feed. Authorization happens here, before
 * anything reaches the client: blocks, ghost mode, expiry, audience membership,
 * report-and-hide, and, for nearby Moments, a fresh, in-band presence
 * resolved through the existing proximity pipeline.
 *
 * The response never says *why* something was excluded, and never carries
 * coordinates: `loadNearbyForUser` yields coarse bands only.
 */
export async function buildMomentFeed(
  admin: Admin,
  viewerId: string,
  nowMs = Date.now()
): Promise<VisibleMoment[]> {
  const nowIso = new Date(nowMs).toISOString();

  const [{ data: friendships }, { data: blocks }, { data: hidden }] = await Promise.all([
    admin
      .from("friendships")
      .select("user_one_id, user_two_id")
      .or(`user_one_id.eq.${viewerId},user_two_id.eq.${viewerId}`),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
    admin.from("hidden_content").select("content_id").eq("user_id", viewerId).eq("content_type", "moment")
  ]);

  const friendIds = (friendships ?? []).map((friendship) =>
    friendship.user_one_id === viewerId ? friendship.user_two_id : friendship.user_one_id
  );
  const blockedIds = new Set(
    (blocks ?? []).map((block) =>
      block.blocker_id === viewerId ? block.blocked_id : block.blocker_id
    )
  );
  const hiddenIds = new Set((hidden ?? []).map((row) => row.content_id));

  // Authors worth querying: my Muddies (minus blocks) plus myself.
  const authorIds = [...new Set([...friendIds.filter((id) => !blockedIds.has(id)), viewerId])];
  if (authorIds.length === 0) return [];

  const { data: moments } = await admin
    .from("moments")
    .select(
      "id, author_id, content_type, text_content, media_id, caption, audience_type, status, expires_at, created_at"
    )
    .in("author_id", authorIds)
    .neq("audience_type", "public")
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(100);

  const candidates = moments ?? [];
  if (candidates.length === 0) return [];

  const momentIds = candidates.map((moment) => moment.id);
  const otherAuthorIds = [...new Set(candidates.map((m) => m.author_id))];

  const [{ data: targets }, { data: profiles }, { data: myReactions }, { data: allReactions }] = await Promise.all([
    admin.from("moment_audience_targets").select("moment_id, target_type, target_id").in("moment_id", momentIds),
    admin.from("profiles").select("user_id, full_name, avatar_url, visibility_status").in("user_id", otherAuthorIds),
    admin.from("moment_reactions").select("moment_id, reaction_type").eq("user_id", viewerId).in("moment_id", momentIds),
    // Aggregate reaction totals per Moment — types and counts only, never who
    // reacted. reaction_type is needed for the compact per-emoji breakdown.
    admin.from("moment_reactions").select("moment_id, reaction_type").in("moment_id", momentIds)
  ]);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const reactionByMoment = new Map((myReactions ?? []).map((row) => [row.moment_id, row.reaction_type]));
  const reactionCountByMoment = new Map<string, number>();
  const breakdownByMoment = new Map<string, Record<string, number>>();
  for (const row of allReactions ?? []) {
    reactionCountByMoment.set(row.moment_id, (reactionCountByMoment.get(row.moment_id) ?? 0) + 1);
    const breakdown = breakdownByMoment.get(row.moment_id) ?? {};
    breakdown[row.reaction_type] = (breakdown[row.reaction_type] ?? 0) + 1;
    breakdownByMoment.set(row.moment_id, breakdown);
  }

  // Reach for the viewer's OWN Moments only, so nothing else needs filtering
  // downstream.
  const ownIds = candidates.filter((entry) => entry.author_id === viewerId).map((entry) => entry.id);
  const viewCountByMoment = new Map<string, number>();
  if (ownIds.length > 0) {
    const { data: viewRows } = await admin.from("moment_views").select("moment_id").in("moment_id", ownIds);
    for (const row of viewRows ?? []) {
      viewCountByMoment.set(row.moment_id, (viewCountByMoment.get(row.moment_id) ?? 0) + 1);
    }
  }

  const targetsByMoment = new Map<string, Array<{ target_type: string; target_id: string }>>();
  for (const target of targets ?? []) {
    if (!targetsByMoment.has(target.moment_id)) targetsByMoment.set(target.moment_id, []);
    targetsByMoment.get(target.moment_id)!.push(target);
  }

  // Nearby set: resolved once, only if some Moment actually needs it.
  let nearbyFreshIds: Set<string> | null = null;
  const needsNearby = candidates.some((moment) => moment.audience_type === "nearby_muddies");
  if (needsNearby) {
    try {
      const nearby = await loadNearbyForUser(admin, viewerId);
      nearbyFreshIds = new Set(
        nearby
          .filter(
            (friend) =>
              friend.proximity_level !== "hidden" &&
              friend.freshness_state !== "stale"
          )
          .map((friend) => friend.friend_id)
      );
    } catch {
      // Fail closed: if proximity can't be resolved, nearby Moments don't show.
      nearbyFreshIds = new Set();
    }
  }

  // Per-author facts needed for audience checks, resolved once per author.
  const closeFriendOf = new Map<string, boolean>();
  const myCirclesOf = new Map<string, Set<string>>();
  for (const authorId of otherAuthorIds) {
    if (authorId === viewerId) continue;
    const needsClose = candidates.some(
      (m) => m.author_id === authorId && m.audience_type === "close_friends"
    );
    const needsCircles = candidates.some(
      (m) => m.author_id === authorId && m.audience_type === "selected_circles"
    );
    if (needsClose) closeFriendOf.set(authorId, await isCloseFriend(admin, authorId, viewerId));
    if (needsCircles) myCirclesOf.set(authorId, await viewerCircleIds(admin, authorId, viewerId));
  }

  const visible: VisibleMoment[] = [];
  for (const moment of candidates) {
    const isAuthor = moment.author_id === viewerId;
    const profile = profileById.get(moment.author_id);
    if (!profile && !isAuthor) continue;

    const momentTargets = targetsByMoment.get(moment.id) ?? [];
    let viewerInAudience = false;
    switch (moment.audience_type) {
      case "close_friends":
        viewerInAudience = closeFriendOf.get(moment.author_id) ?? false;
        break;
      case "selected_muddies":
        viewerInAudience = momentTargets.some(
          (target) => target.target_type === "user" && target.target_id === viewerId
        );
        break;
      case "selected_circles": {
        const circles = myCirclesOf.get(moment.author_id) ?? new Set();
        viewerInAudience = momentTargets.some(
          (target) => target.target_type === "circle" && circles.has(target.target_id)
        );
        break;
      }
      case "nearby_muddies":
        viewerInAudience = true; // gated by viewerNearbyAndFresh below
        break;
      default:
        viewerInAudience = false;
    }

    const decision = resolveMomentVisibility({
      isAuthor,
      status: moment.status,
      expiresAtMs: Date.parse(moment.expires_at),
      nowMs,
      areApprovedMuddies: isAuthor || friendIds.includes(moment.author_id),
      isBlockedEitherDirection: blockedIds.has(moment.author_id),
      authorGhostMode: profile?.visibility_status === "ghost",
      viewerHidThis: hiddenIds.has(moment.id),
      audienceType: moment.audience_type,
      viewerInAudience,
      viewerNearbyAndFresh: nearbyFreshIds?.has(moment.author_id) ?? false
    });
    if (!decision.visible) continue;

    visible.push({
      id: moment.id,
      authorId: moment.author_id,
      authorName: isAuthor ? "You" : profile?.full_name?.trim() || "A Muddy",
      authorAvatarUrl: profile?.avatar_url ?? null,
      contentType: moment.content_type,
      textContent: moment.text_content,
      caption: moment.caption,
      mediaUrl: moment.media_id ? await signMediaForAsset(admin, moment.media_id, "feed") : null,
      expiresAt: moment.expires_at,
      createdAt: moment.created_at,
      myReaction: reactionByMoment.get(moment.id) ?? null,
      reactionCount: reactionCountByMoment.get(moment.id) ?? 0,
      reactionBreakdown: breakdownByMoment.get(moment.id) ?? {},
      isAuthor,
      audienceLabel: isAuthor ? moment.audience_type : null,
      // Reach is the author's own figure. A Muddy viewing a private Moment
      // learns nothing about how many others saw it.
      viewCount: isAuthor ? (viewCountByMoment.get(moment.id) ?? 0) : null,
      // Tune In is a Spotlight concept; a private Moment attributes none.
      tunedInFromThis: null,
      creatorTunedIn: false,
      creatorTunedInCount: 0
    });
  }

  return visible;
}

/**
 * Builds the authenticated-community Open Moments feed. Ranking is deliberately
 * recency-only for the first release: no location, proximity, sensitive
 * attributes, or fabricated engagement signals influence discovery.
 */
/**
 * The Spotlight feed: live public Moments, ranked for this viewer.
 *
 * Ranking blends recency, engagement rate and affinity (see
 * `rankSpotlightMoments`), so tuning in boosts a creator without turning the
 * feed into a private timeline. Discovery of new creators always survives.
 *
 * Authorization order matters and is unchanged: the feature flag, then blocks,
 * then report-and-hide, then the shared visibility rules. Ranking runs LAST, on
 * an already-authorized set, so a scoring change can never widen visibility.
 *
 * Kept as `buildOpenMomentFeed`'s replacement rather than a parallel function:
 * two feeds over the same rows would be two places for an authorization rule to
 * drift out of sync.
 */
export async function buildSpotlightFeed(
  admin: Admin,
  viewerId: string,
  nowMs = Date.now()
): Promise<VisibleMoment[]> {
  if (!(await isOpenMomentsEnabled(admin))) return [];

  const nowIso = new Date(nowMs).toISOString();
  const [{ data: blocks }, { data: hidden }, { data: moments }, { data: friendships }, { data: myTuneIns }] =
    await Promise.all([
      admin
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
      admin.from("hidden_content").select("content_id").eq("user_id", viewerId).eq("content_type", "moment"),
      admin
        .from("moments")
        .select(
          "id, author_id, content_type, text_content, media_id, caption, audience_type, status, expires_at, created_at"
        )
        .eq("audience_type", "public")
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        .or(`user_one_id.eq.${viewerId},user_two_id.eq.${viewerId}`),
      admin.from("tune_ins").select("creator_id").eq("viewer_id", viewerId)
    ]);

  const blockedIds = new Set(
    (blocks ?? []).map((block) => (block.blocker_id === viewerId ? block.blocked_id : block.blocker_id))
  );
  const hiddenIds = new Set((hidden ?? []).map((row) => row.content_id));
  const muddyIds = new Set(
    (friendships ?? []).map((row) => (row.user_one_id === viewerId ? row.user_two_id : row.user_one_id))
  );
  const tunedInIds = new Set((myTuneIns ?? []).map((row) => row.creator_id));

  const candidates = (moments ?? []).filter(
    (moment) => !blockedIds.has(moment.author_id) && !hiddenIds.has(moment.id)
  );
  if (candidates.length === 0) return [];

  const momentIds = candidates.map((moment) => moment.id);
  const authorIds = [...new Set(candidates.map((moment) => moment.author_id))];

  const [{ data: profiles }, { data: myReactions }, { data: allReactions }, { data: engagement }, { data: creatorCounts }] =
    await Promise.all([
      admin.from("profiles").select("user_id, full_name, avatar_url, visibility_status").in("user_id", authorIds),
      admin.from("moment_reactions").select("moment_id, reaction_type").eq("user_id", viewerId).in("moment_id", momentIds),
      admin.from("moment_reactions").select("moment_id, reaction_type").in("moment_id", momentIds),
      // Aggregates only. The RPC is security definer so it can COUNT rows the
      // caller cannot read individually, which is what keeps tune-in identities
      // unreachable while the totals stay visible.
      admin.rpc("moment_engagement", { moment_ids: momentIds }),
      admin.rpc("tune_in_counts", { creator_ids: authorIds })
    ]);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const reactionByMoment = new Map((myReactions ?? []).map((row) => [row.moment_id, row.reaction_type]));
  const reactionCountByMoment = new Map<string, number>();
  const breakdownByMoment = new Map<string, Record<string, number>>();
  for (const row of allReactions ?? []) {
    reactionCountByMoment.set(row.moment_id, (reactionCountByMoment.get(row.moment_id) ?? 0) + 1);
    const breakdown = breakdownByMoment.get(row.moment_id) ?? {};
    breakdown[row.reaction_type] = (breakdown[row.reaction_type] ?? 0) + 1;
    breakdownByMoment.set(row.moment_id, breakdown);
  }
  const engagementByMoment = new Map(
    (engagement ?? []).map((row) => [
      row.moment_id,
      { views: Number(row.view_count), tunedIn: Number(row.tuned_in_count) }
    ])
  );
  const tuneInCountByCreator = new Map(
    (creatorCounts ?? []).map((row) => [row.creator_id, Number(row.tuned_in_count)])
  );

  // Authorize first, rank second.
  const authorized = candidates.filter((moment) => {
    const isAuthor = moment.author_id === viewerId;
    const profile = profileById.get(moment.author_id);
    if (!profile && !isAuthor) return false;
    return resolveMomentVisibility({
      isAuthor,
      status: moment.status,
      expiresAtMs: Date.parse(moment.expires_at),
      nowMs,
      areApprovedMuddies: muddyIds.has(moment.author_id),
      isBlockedEitherDirection: blockedIds.has(moment.author_id),
      authorGhostMode: profile?.visibility_status === "ghost",
      viewerHidThis: hiddenIds.has(moment.id),
      audienceType: "public",
      viewerInAudience: true,
      viewerNearbyAndFresh: false
    }).visible;
  });

  const ranked = rankSpotlightMoments(
    authorized.map((moment) => ({
      moment,
      momentId: moment.id,
      createdAtMs: Date.parse(moment.created_at),
      tunedIn: tunedInIds.has(moment.author_id),
      isMuddy: muddyIds.has(moment.author_id),
      reactionCount: reactionCountByMoment.get(moment.id) ?? 0,
      viewCount: engagementByMoment.get(moment.id)?.views ?? 0
    })),
    nowMs
  );

  // Signing is a network round trip per asset, so the whole page is signed in
  // parallel rather than sequentially inside the loop.
  const signed = await Promise.all(
    ranked.map((entry) =>
      entry.moment.media_id ? signMediaForAsset(admin, entry.moment.media_id, "feed") : Promise.resolve(null)
    )
  );

  return ranked.map((entry, index) => {
    const moment = entry.moment;
    const isAuthor = moment.author_id === viewerId;
    const profile = profileById.get(moment.author_id);
    const stats = engagementByMoment.get(moment.id);
    return {
      id: moment.id,
      authorId: moment.author_id,
      authorName: isAuthor ? "You" : profile?.full_name?.trim() || "A Muddy",
      authorAvatarUrl: profile?.avatar_url ?? null,
      contentType: moment.content_type,
      textContent: moment.text_content,
      caption: moment.caption,
      mediaUrl: signed[index],
      expiresAt: moment.expires_at,
      createdAt: moment.created_at,
      myReaction: reactionByMoment.get(moment.id) ?? null,
      reactionCount: reactionCountByMoment.get(moment.id) ?? 0,
      reactionBreakdown: breakdownByMoment.get(moment.id) ?? {},
      isAuthor,
      audienceLabel: isAuthor ? "public" : null,
      // Reach and attributed tune-ins are the author's own analytics. Other
      // viewers get null, so a Spotlight card cannot become a scoreboard of
      // someone else's numbers.
      viewCount: isAuthor ? (stats?.views ?? 0) : null,
      tunedInFromThis: isAuthor ? (stats?.tunedIn ?? 0) : null,
      creatorTunedIn: tunedInIds.has(moment.author_id),
      creatorTunedInCount: tuneInCountByCreator.get(moment.author_id) ?? 0
    };
  });
}

/**
 * Records that a viewer saw a Moment. Idempotent: one row per viewer per
 * Moment, so re-opening never inflates reach. Authorization is the caller's
 * job — this is only reached from an action that has already built a feed the
 * viewer is allowed to see.
 */
export async function recordMomentView(admin: Admin, momentId: string, viewerId: string): Promise<void> {
  await admin
    .from("moment_views")
    .upsert({ moment_id: momentId, viewer_id: viewerId }, { onConflict: "moment_id,viewer_id", ignoreDuplicates: true });
}

export type TuneInEntry = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  tunedInAt: string;
  /** Live Spotlight Moments from this creator that the viewer may see. */
  liveMomentCount: number;
  /**
   * At least one live Moment the viewer has not opened. Drives the gentle signal
   * animation, which is a CONTENT state rather than a notification.
   */
  hasUnviewed: boolean;
};

/**
 * The viewer's own Tune In list. Visible to nobody else: the RLS select policy
 * on tune_ins is scoped to viewer_id, and there is deliberately no policy that
 * would let a creator read the rows pointing at them.
 */
export async function loadMyTuneIns(
  admin: Admin,
  viewerId: string,
  nowMs = Date.now()
): Promise<TuneInEntry[]> {
  const { data: rows } = await admin
    .from("tune_ins")
    .select("creator_id, created_at")
    .eq("viewer_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (!rows?.length) return [];

  const creatorIds = rows.map((row) => row.creator_id);
  const nowIso = new Date(nowMs).toISOString();

  // Four flat queries regardless of how many creators are tuned in: profiles,
  // their live Spotlight Moments, this viewer's view rows, and blocks. No
  // per-creator round trip.
  const [{ data: profiles }, { data: liveMoments }, { data: blocks }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url, visibility_status").in("user_id", creatorIds),
    admin
      .from("moments")
      .select("id, author_id")
      .in("author_id", creatorIds)
      .eq("audience_type", "public")
      .eq("status", "active")
      .gt("expires_at", nowIso),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
  ]);

  const momentIds = (liveMoments ?? []).map((row) => row.id);
  const { data: myViews } = momentIds.length
    ? await admin.from("moment_views").select("moment_id").eq("viewer_id", viewerId).in("moment_id", momentIds)
    : { data: [] as { moment_id: string }[] };

  const blockedIds = new Set(
    (blocks ?? []).map((row) => (row.blocker_id === viewerId ? row.blocked_id : row.blocker_id))
  );
  const viewedIds = new Set((myViews ?? []).map((row) => row.moment_id));
  const byId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

  const liveByCreator = new Map<string, { total: number; unviewed: number }>();
  for (const moment of liveMoments ?? []) {
    // A ghosting author's Moments are not shown, matching the feed's own rule.
    if (byId.get(moment.author_id)?.visibility_status === "ghost") continue;
    const entry = liveByCreator.get(moment.author_id) ?? { total: 0, unviewed: 0 };
    entry.total += 1;
    if (!viewedIds.has(moment.id)) entry.unviewed += 1;
    liveByCreator.set(moment.author_id, entry);
  }

  return rows
    .filter((row) => !blockedIds.has(row.creator_id))
    .map((row) => {
      const live = liveByCreator.get(row.creator_id);
      return {
        creatorId: row.creator_id,
        name: byId.get(row.creator_id)?.full_name?.trim() || "A Muddy",
        avatarUrl: byId.get(row.creator_id)?.avatar_url ?? null,
        tunedInAt: row.created_at,
        liveMomentCount: live?.total ?? 0,
        hasUnviewed: (live?.unviewed ?? 0) > 0
      };
    })
    // Unviewed content first, then creators with live-but-seen Moments, then
    // everyone else — so new content is never something the user has to hunt for.
    .sort((a, b) => {
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      if ((a.liveMomentCount > 0) !== (b.liveMomentCount > 0)) return a.liveMomentCount > 0 ? -1 : 1;
      return Date.parse(b.tunedInAt) - Date.parse(a.tunedInAt);
    });
}

/**
 * A single creator's live Spotlight Moments, for the Tuned In viewing lane.
 *
 * Reuses the Spotlight feed rather than querying moments directly, so every
 * authorization rule (feature flag, blocks, ghost mode, report-and-hide, expiry)
 * applies identically and cannot drift. Unviewed Moments come first so tapping a
 * creator with something new opens the new thing.
 */
export async function loadCreatorSpotlightMoments(
  admin: Admin,
  viewerId: string,
  creatorId: string,
  nowMs = Date.now()
): Promise<VisibleMoment[]> {
  const feed = await buildSpotlightFeed(admin, viewerId, nowMs);
  const mine = feed.filter((moment) => moment.authorId === creatorId);
  if (mine.length === 0) return [];

  const { data: myViews } = await admin
    .from("moment_views")
    .select("moment_id")
    .eq("viewer_id", viewerId)
    .in(
      "moment_id",
      mine.map((moment) => moment.id)
    );
  const viewedIds = new Set((myViews ?? []).map((row) => row.moment_id));

  return [...mine].sort((a, b) => {
    const aSeen = viewedIds.has(a.id);
    const bSeen = viewedIds.has(b.id);
    if (aSeen !== bSeen) return aSeen ? 1 : -1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export type MomentsCreatorHub = {
  creatorId: string;
  name: string;
  avatarUrl: string | null;
  /** The public aggregate. Never a list, and never called "followers". */
  tunedInCount: number;
  /** Live Spotlight Moments this viewer can see from the creator. */
  liveSpotlightCount: number;
  viewerTunedIn: boolean;
  viewerIsMuddy: boolean;
  isSelf: boolean;
};

/**
 * A creator's Moments hub: a content surface layered on the existing profile,
 * not a replacement for it.
 *
 * Deliberately narrow. It exposes a display name, an avatar, an aggregate
 * tune-in count and a live-Moment count, and nothing else — no location, status,
 * Muddy list, contact details or private profile fields, so a Spotlight viewer
 * cannot use it to learn anything the creator did not publish.
 */
export async function loadMomentsCreatorHub(
  admin: Admin,
  viewerId: string,
  creatorId: string,
  nowMs = Date.now()
): Promise<MomentsCreatorHub | null> {
  const [{ data: profile }, { data: blocks }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url").eq("user_id", creatorId).maybeSingle(),
    admin
      .from("blocked_users")
      .select("blocker_id")
      .or(
        `and(blocker_id.eq.${viewerId},blocked_id.eq.${creatorId}),and(blocker_id.eq.${creatorId},blocked_id.eq.${viewerId})`
      )
      .limit(1)
  ]);
  if (!profile) return null;
  // A blocked creator has no hub for this viewer at all.
  if (blocks?.length) return null;

  const nowIso = new Date(nowMs).toISOString();
  const [{ data: counts }, { data: mine }, { data: friendship }, { count: liveCount }] = await Promise.all([
    admin.rpc("tune_in_counts", { creator_ids: [creatorId] }),
    admin.from("tune_ins").select("id").eq("viewer_id", viewerId).eq("creator_id", creatorId).maybeSingle(),
    admin
      .from("friendships")
      .select("user_one_id")
      .or(
        `and(user_one_id.eq.${viewerId},user_two_id.eq.${creatorId}),and(user_one_id.eq.${creatorId},user_two_id.eq.${viewerId})`
      )
      .limit(1),
    admin
      .from("moments")
      .select("id", { count: "exact", head: true })
      .eq("author_id", creatorId)
      .eq("audience_type", "public")
      .eq("status", "active")
      .gt("expires_at", nowIso)
  ]);

  return {
    creatorId,
    name: profile.full_name?.trim() || "A Muddy",
    avatarUrl: profile.avatar_url,
    tunedInCount: Number((counts ?? [])[0]?.tuned_in_count ?? 0),
    liveSpotlightCount: liveCount ?? 0,
    viewerTunedIn: Boolean(mine),
    viewerIsMuddy: Boolean(friendship?.length),
    isSelf: creatorId === viewerId
  };
}

export type MomentsRingEntry = {
  authorId: string;
  name: string;
  avatarUrl: string | null;
  momentCount: number;
  /** True when the viewer has not yet opened every live Moment from them. */
  hasUnseen: boolean;
};

/**
 * The horizontal avatar row on Moments Home: Muddies with at least one live
 * private Moment the viewer can see, plus the viewer's own.
 *
 * Built from the ALREADY-AUTHORIZED feed rather than a second query, so the row
 * can never surface someone whose Moment the feed excluded.
 */
export function buildMomentsRing(feed: VisibleMoment[], seenIds: Set<string>): MomentsRingEntry[] {
  const byAuthor = new Map<string, MomentsRingEntry>();
  for (const moment of feed) {
    const entry = byAuthor.get(moment.authorId) ?? {
      authorId: moment.authorId,
      name: moment.authorName,
      avatarUrl: moment.authorAvatarUrl,
      momentCount: 0,
      hasUnseen: false
    };
    entry.momentCount += 1;
    if (!seenIds.has(moment.id)) entry.hasUnseen = true;
    byAuthor.set(moment.authorId, entry);
  }
  // Own row first, then unseen, then alphabetical — so there is something new to
  // look at before anything already read.
  return [...byAuthor.values()].sort((a, b) => {
    if ((a.name === "You") !== (b.name === "You")) return a.name === "You" ? -1 : 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Hides content for one viewer only (spec §50 report-and-hide). */
export async function hideContentForUser(
  admin: Admin,
  userId: string,
  contentType: ReportableContentType,
  contentId: string
) {
  await admin
    .from("hidden_content")
    .upsert({ user_id: userId, content_type: contentType, content_id: contentId }, {
      onConflict: "user_id,content_type,content_id"
    });
}

/** Queues media for deletion when its parent expires or is deleted (§45). */
export async function queueMediaDeletion(
  admin: Admin,
  mediaId: string,
  reason: "parent_deleted" | "parent_expired" | "user_deleted" | "moderation"
) {
  await admin
    .from("media_deletion_queue")
    .upsert({ media_asset_id: mediaId, reason }, { onConflict: "media_asset_id" });
}
