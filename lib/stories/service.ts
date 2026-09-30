import "server-only";

import { queueMediaDeletion, signMediaForAsset } from "@/lib/content/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type {
  StoryAudienceType,
  StoryCreationContext,
  StoryItem,
  StoryEngagement,
  StorySummary
} from "@/lib/stories/types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type MomentRow = Database["public"]["Tables"]["moments"]["Row"];
type StoryRow = Pick<
  MomentRow,
  "id" | "author_id" | "media_id" | "caption" | "audience_type" | "expires_at" | "created_at"
>;

type VisibleRows = {
  rows: StoryRow[];
  viewedIds: Set<string>;
};

/**
 * Story authorization fails closed. The generic relationship helpers are
 * intentionally forgiving when a read errors, which is useful for ordinary
 * projections but not for private temporary media. Here, a friendship/block
 * read failure means nobody else's Story is returned.
 */
async function loadEligibleStoryMuddyIds(
  admin: Admin,
  ownerId: string,
  candidateIds: string[]
): Promise<Set<string> | null> {
  const unique = [...new Set(candidateIds)].filter((id) => id && id !== ownerId);
  if (unique.length === 0) return new Set();

  const [{ data: friendships, error: friendshipsError }, { data: blocks, error: blocksError }] =
    await Promise.all([
      admin
        .from("friendships")
        .select("user_one_id, user_two_id")
        .or(`user_one_id.eq.${ownerId},user_two_id.eq.${ownerId}`)
        .is("ended_at", null),
      admin
        .from("blocked_users")
        .select("blocker_id, blocked_id")
        .or(`blocker_id.eq.${ownerId},blocked_id.eq.${ownerId}`)
    ]);

  if (friendshipsError || blocksError) return null;

  const friendIds = new Set(
    (friendships ?? []).map((row) =>
      row.user_one_id === ownerId ? row.user_two_id : row.user_one_id
    )
  );
  const blockedIds = new Set(
    (blocks ?? []).map((row) =>
      row.blocker_id === ownerId ? row.blocked_id : row.blocker_id
    )
  );

  return new Set(unique.filter((id) => friendIds.has(id) && !blockedIds.has(id)));
}

function isStoryAudience(value: MomentRow["audience_type"]): value is StoryAudienceType {
  return value === "all_muddies" || value === "close_friends" || value === "selected_muddies";
}

async function loadCloseFriendAuthors(
  admin: Admin,
  viewerId: string,
  authorIds: string[]
): Promise<Set<string> | null> {
  if (authorIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("close_friend_relationships")
    .select("owner_id")
    .eq("friend_id", viewerId)
    .in("owner_id", authorIds);
  if (error) return null;
  return new Set((data ?? []).map((row) => row.owner_id));
}

async function loadSelectedStoryIds(
  admin: Admin,
  viewerId: string,
  storyIds: string[]
): Promise<Set<string> | null> {
  if (storyIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("moment_audience_targets")
    .select("moment_id")
    .eq("target_type", "user")
    .eq("target_id", viewerId)
    .in("moment_id", storyIds);
  if (error) return null;
  return new Set((data ?? []).map((row) => row.moment_id));
}

async function loadHiddenStoryIds(
  admin: Admin,
  viewerId: string,
  storyIds: string[]
): Promise<Set<string> | null> {
  if (storyIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("hidden_content")
    .select("content_id")
    .eq("user_id", viewerId)
    .eq("content_type", "moment")
    .in("content_id", storyIds);
  if (error) return null;
  return new Set((data ?? []).map((row) => row.content_id));
}

async function loadViewedStoryIds(
  admin: Admin,
  viewerId: string,
  storyIds: string[]
): Promise<Set<string>> {
  if (storyIds.length === 0) return new Set();
  const { data } = await admin
    .from("moment_views")
    .select("moment_id")
    .eq("viewer_id", viewerId)
    .in("moment_id", storyIds);
  return new Set((data ?? []).map((row) => row.moment_id));
}

async function visibleStoryRowsForAuthors(
  admin: Admin,
  viewerId: string,
  authorIds: string[],
  nowMs = Date.now()
): Promise<VisibleRows> {
  const uniqueAuthors = [...new Set(authorIds.filter(Boolean))];
  if (uniqueAuthors.length === 0) return { rows: [], viewedIds: new Set() };

  const otherAuthors = uniqueAuthors.filter((id) => id !== viewerId);
  const eligibleAuthors = await loadEligibleStoryMuddyIds(admin, viewerId, otherAuthors);
  if (eligibleAuthors === null) return { rows: [], viewedIds: new Set() };

  const allowedAuthors = new Set<string>([viewerId, ...eligibleAuthors]);
  const queryAuthors = uniqueAuthors.filter((id) => allowedAuthors.has(id));
  if (queryAuthors.length === 0) return { rows: [], viewedIds: new Set() };

  const nowIso = new Date(nowMs).toISOString();
  const { data } = await admin
    .from("moments")
    .select("id, author_id, media_id, caption, audience_type, expires_at, created_at")
    .in("author_id", queryAuthors)
    .eq("surface", "story")
    .eq("content_type", "photo")
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: true });

  const candidates = (data ?? []).filter((row): row is StoryRow => Boolean(row.media_id) && isStoryAudience(row.audience_type));
  if (candidates.length === 0) return { rows: [], viewedIds: new Set() };

  const storyIds = candidates.map((row) => row.id);
  const closeAuthors = [...new Set(candidates.filter((row) => row.audience_type === "close_friends").map((row) => row.author_id))];
  const selectedIds = candidates.filter((row) => row.audience_type === "selected_muddies").map((row) => row.id);

  const [closeFriendAuthors, selectedStoryIds, hiddenStoryIds, viewedIds] = await Promise.all([
    loadCloseFriendAuthors(admin, viewerId, closeAuthors),
    loadSelectedStoryIds(admin, viewerId, selectedIds),
    loadHiddenStoryIds(admin, viewerId, storyIds),
    loadViewedStoryIds(admin, viewerId, storyIds)
  ]);

  if (closeFriendAuthors === null || selectedStoryIds === null || hiddenStoryIds === null) {
    return { rows: [], viewedIds: new Set() };
  }

  const rows = candidates.filter((row) => {
    if (hiddenStoryIds.has(row.id)) return false;
    if (row.author_id === viewerId) return true;
    if (row.audience_type === "all_muddies") return true;
    if (row.audience_type === "close_friends") return closeFriendAuthors.has(row.author_id);
    return selectedStoryIds.has(row.id);
  });

  return { rows, viewedIds };
}

export async function loadStorySummariesForAuthors(
  admin: Admin,
  viewerId: string,
  authorIds: string[],
  nowMs = Date.now()
): Promise<Record<string, StorySummary>> {
  const { rows, viewedIds } = await visibleStoryRowsForAuthors(admin, viewerId, authorIds, nowMs);
  const summaries: Record<string, StorySummary> = {};

  for (const row of rows) {
    const current = summaries[row.author_id] ?? {
      authorId: row.author_id,
      activeCount: 0,
      unseenCount: 0,
      hasUnseen: false,
      nextExpiryAt: null,
      latestStoryAt: null
    };

    current.activeCount += 1;
    if (row.author_id !== viewerId && !viewedIds.has(row.id)) current.unseenCount += 1;
    current.hasUnseen = row.author_id === viewerId ? current.activeCount > 0 : current.unseenCount > 0;

    if (!current.nextExpiryAt || Date.parse(row.expires_at) < Date.parse(current.nextExpiryAt)) {
      current.nextExpiryAt = row.expires_at;
    }
    if (!current.latestStoryAt || Date.parse(row.created_at) > Date.parse(current.latestStoryAt)) {
      current.latestStoryAt = row.created_at;
    }
    summaries[row.author_id] = current;
  }

  return summaries;
}

export async function loadStorySummary(
  admin: Admin,
  viewerId: string,
  authorId: string,
  nowMs = Date.now()
): Promise<StorySummary | null> {
  const summaries = await loadStorySummariesForAuthors(admin, viewerId, [authorId], nowMs);
  return summaries[authorId] ?? null;
}

export async function loadStoriesForAuthor(
  admin: Admin,
  viewerId: string,
  authorId: string,
  nowMs = Date.now()
): Promise<StoryItem[]> {
  const { rows, viewedIds } = await visibleStoryRowsForAuthors(admin, viewerId, [authorId], nowMs);
  if (rows.length === 0) return [];

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("user_id", authorId)
    .maybeSingle();

  const { data: reactions, error: reactionsError } = await admin.from("moment_reactions")
    .select("moment_id").eq("user_id", viewerId).eq("reaction_type", "heart")
    .in("moment_id", rows.map((row) => row.id));
  if (reactionsError) return [];
  const likedIds = new Set((reactions ?? []).map((row) => row.moment_id));

  const authorName = profile?.full_name?.trim() || (authorId === viewerId ? "You" : "A Muddy");
  const signed = await Promise.all(
    rows.map(async (row) => {
      if (!row.media_id || !isStoryAudience(row.audience_type)) return null;
      const mediaUrl = await signMediaForAsset(admin, row.media_id, "feed");
      if (!mediaUrl) return null;
      return {
        id: row.id,
        authorId: row.author_id,
        authorName,
        authorAvatarUrl: profile?.avatar_url ?? null,
        mediaId: row.media_id,
        mediaUrl,
        caption: row.caption,
        audienceType: row.audience_type,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        viewed: row.author_id === viewerId || viewedIds.has(row.id),
        liked: likedIds.has(row.id),
        isAuthor: row.author_id === viewerId
      } satisfies StoryItem;
    })
  );

  return signed.filter((item): item is StoryItem => item !== null);
}

export async function recordStoryView(
  admin: Admin,
  viewerId: string,
  storyId: string
): Promise<boolean> {
  const { data: story } = await admin
    .from("moments")
    .select("id, author_id")
    .eq("id", storyId)
    .eq("surface", "story")
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!story) return false;
  if (story.author_id === viewerId) return true;

  const { rows } = await visibleStoryRowsForAuthors(admin, viewerId, [story.author_id]);
  if (!rows.some((row) => row.id === storyId)) return false;

  const { error } = await admin
    .from("moment_views")
    .upsert(
      { moment_id: storyId, viewer_id: viewerId, viewed_at: new Date().toISOString() },
      { onConflict: "moment_id,viewer_id" }
    );
  return !error;
}

export async function deleteStory(
  admin: Admin,
  ownerId: string,
  storyId: string
): Promise<boolean> {
  const { data: story } = await admin
    .from("moments")
    .select("id, media_id")
    .eq("id", storyId)
    .eq("author_id", ownerId)
    .eq("surface", "story")
    .maybeSingle();
  if (!story) return false;

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("moments")
    .update({ status: "deleted_by_user", deleted_at: nowIso, updated_at: nowIso })
    .eq("id", storyId)
    .eq("author_id", ownerId)
    .eq("surface", "story");
  if (error) return false;

  await Promise.all([
    admin.from("moment_views").delete().eq("moment_id", storyId),
    admin.from("moment_audience_targets").delete().eq("moment_id", storyId),
    admin.from("moment_reactions").delete().eq("moment_id", storyId),
    admin
      .from("hidden_content")
      .delete()
      .eq("content_type", "moment")
      .eq("content_id", storyId)
  ]);

  if (story.media_id) await queueMediaDeletion(admin, story.media_id, "user_deleted");
  return true;
}

export async function activeStoryCount(admin: Admin, ownerId: string, nowMs = Date.now()): Promise<number> {
  const { count } = await admin
    .from("moments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", ownerId)
    .eq("surface", "story")
    .eq("status", "active")
    .gt("expires_at", new Date(nowMs).toISOString());
  return count ?? 0;
}

export async function loadStoryCreationContext(admin: Admin, ownerId: string): Promise<StoryCreationContext> {
  const { data: friendships, error: friendshipsError } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${ownerId},user_two_id.eq.${ownerId}`)
    .is("ended_at", null);

  if (friendshipsError) return { muddies: [], closeFriendsAvailable: false };

  const friendIds = [
    ...new Set(
      (friendships ?? []).map((row) => (row.user_one_id === ownerId ? row.user_two_id : row.user_one_id))
    )
  ].filter((id) => id !== ownerId);

  if (friendIds.length === 0) return { muddies: [], closeFriendsAvailable: false };

  const eligible = await loadEligibleStoryMuddyIds(admin, ownerId, friendIds);
  if (eligible === null) return { muddies: [], closeFriendsAvailable: false };
  const eligibleIds = friendIds.filter((id) => eligible.has(id));
  if (eligibleIds.length === 0) return { muddies: [], closeFriendsAvailable: false };

  const [
    { data: profiles, error: profilesError },
    { count: closeCount, error: closeFriendsError }
  ] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url").in("user_id", eligibleIds),
    admin
      .from("close_friend_relationships")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .in("friend_id", eligibleIds)
  ]);

  if (profilesError || closeFriendsError) return { muddies: [], closeFriendsAvailable: false };

  return {
    muddies: (profiles ?? [])
      .map((profile) => ({
        id: profile.user_id,
        name: profile.full_name?.trim() || "A Muddy",
        avatarUrl: profile.avatar_url
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    closeFriendsAvailable: (closeCount ?? 0) > 0
  };
}

export async function validateStoryAudienceTargets(
  admin: Admin,
  ownerId: string,
  audienceType: StoryAudienceType,
  targetIds: string[]
): Promise<boolean> {
  if (audienceType === "all_muddies") return true;
  if (audienceType === "close_friends") {
    const { count, error } = await admin
      .from("close_friend_relationships")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId);
    return !error && (count ?? 0) > 0;
  }

  const uniqueTargets = [...new Set(targetIds)].filter((id) => id !== ownerId);
  if (uniqueTargets.length === 0 || uniqueTargets.length !== targetIds.length) return false;

  const eligible = await loadEligibleStoryMuddyIds(admin, ownerId, uniqueTargets);
  if (eligible === null) return false;
  return uniqueTargets.every((targetId) => eligible.has(targetId));
}

/** Creator-only reach and viewer list; never reuse public Moment aggregates. */
export async function loadStoryEngagement(
  admin: Admin,
  ownerId: string,
  storyId: string,
  offset = 0
): Promise<StoryEngagement | null> {
  const { data: story, error: storyError } = await admin.from("moments")
    .select("id").eq("id", storyId).eq("author_id", ownerId)
    .eq("surface", "story").eq("status", "active")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (storyError || !story) return null;

  const pageSize = 50;
  const [{ data: views, count: viewCount, error: viewsError }, { count: likeCount, error: likesError }] = await Promise.all([
    admin.from("moment_views").select("viewer_id, viewed_at", { count: "exact" })
      .eq("moment_id", storyId).neq("viewer_id", ownerId)
      .order("viewed_at", { ascending: false }).order("viewer_id", { ascending: true })
      .range(offset, offset + pageSize - 1),
    admin.from("moment_reactions").select("id", { count: "exact", head: true })
      .eq("moment_id", storyId).eq("reaction_type", "heart").neq("user_id", ownerId)
  ]);
  if (viewsError || likesError) return null;

  const viewerIds = (views ?? []).map((view) => view.viewer_id);
  if (viewerIds.length === 0) return { viewCount: viewCount ?? 0, likeCount: likeCount ?? 0, viewers: [], nextOffset: null };
  const [{ data: profiles, error: profilesError }, { data: likes, error: reactionsError }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url").in("user_id", viewerIds),
    admin.from("moment_reactions").select("user_id").eq("moment_id", storyId)
      .eq("reaction_type", "heart").in("user_id", viewerIds)
  ]);
  if (profilesError || reactionsError) return null;
  const byId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const likedIds = new Set((likes ?? []).map((like) => like.user_id));
  return {
    viewCount: viewCount ?? 0,
    likeCount: likeCount ?? 0,
    viewers: (views ?? []).map((view) => ({
      id: view.viewer_id,
      name: byId.get(view.viewer_id)?.full_name?.trim() || "A Muddy",
      avatarUrl: byId.get(view.viewer_id)?.avatar_url ?? null,
      viewedAt: view.viewed_at,
      liked: likedIds.has(view.viewer_id)
    })),
    nextOffset: offset + viewerIds.length < (viewCount ?? 0) ? offset + viewerIds.length : null
  };
}

/** Desired-state write makes retries safe: one heart per viewer, no toggling RPC. */
export async function setStoryLike(admin: Admin, viewerId: string, storyId: string, liked: boolean): Promise<boolean> {
  const { data: story, error } = await admin.from("moments").select("author_id")
    .eq("id", storyId).eq("surface", "story").eq("status", "active")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error || !story || story.author_id === viewerId) return false;
  const { rows } = await visibleStoryRowsForAuthors(admin, viewerId, [story.author_id]);
  if (!rows.some((row) => row.id === storyId)) return false;
  const result = liked
    ? await admin.from("moment_reactions").upsert(
      { moment_id: storyId, user_id: viewerId, reaction_type: "heart" },
      { onConflict: "moment_id,user_id" })
    : await admin.from("moment_reactions").delete().eq("moment_id", storyId)
      .eq("user_id", viewerId).eq("reaction_type", "heart");
  return !result.error;
}
