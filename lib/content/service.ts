import "server-only";

import { resolveMomentVisibility } from "@/lib/content/moments";
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
  contentType: "text" | "photo";
  textContent: string | null;
  caption: string | null;
  mediaUrl: string | null;
  expiresAt: string;
  createdAt: string;
  myReaction: string | null;
  isAuthor: boolean;
  /** Author-only: what audience this went to (spec §9). */
  audienceLabel: string | null;
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
  const blockedIds = new Set((blocks ?? []).flatMap((block) => [block.blocker_id, block.blocked_id]));
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
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(100);

  const candidates = moments ?? [];
  if (candidates.length === 0) return [];

  const momentIds = candidates.map((moment) => moment.id);
  const otherAuthorIds = [...new Set(candidates.map((m) => m.author_id))];

  const [{ data: targets }, { data: profiles }, { data: myReactions }] = await Promise.all([
    admin.from("moment_audience_targets").select("moment_id, target_type, target_id").in("moment_id", momentIds),
    admin.from("profiles").select("user_id, full_name, avatar_url, visibility_status").in("user_id", otherAuthorIds),
    admin.from("moment_reactions").select("moment_id, reaction_type").eq("user_id", viewerId).in("moment_id", momentIds)
  ]);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const reactionByMoment = new Map((myReactions ?? []).map((row) => [row.moment_id, row.reaction_type]));

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
              friend.proximity_level !== "far" &&
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
      isAuthor,
      audienceLabel: isAuthor ? moment.audience_type : null
    });
  }

  return visible;
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
