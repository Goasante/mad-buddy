"use server";

import { z } from "zod";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import { deliverNotification } from "@/lib/notifications/server";
import {
  areApprovedMuddies,
  batchEligibleMuddyIds,
  isBlockedEitherDirection,
  isCloseFriend,
  viewerCircleIds
} from "@/lib/social/permissions";
import { consumeRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import type { SocializeAreaTier } from "@/lib/social/socialize";
import {
  canStrangerDiscoverUpFor,
  confidenceToAreaTier,
  isLocationFreshEnough
} from "@/lib/social/upfor-discovery";
import {
  buildSafeNearbyFriends,
  type NearbyLocationRow,
  type NearbyProfileRow
} from "@/lib/proximity/backend";
import { guardAction } from "@/lib/admin/enforcement";
import { convertHangoutToPlan } from "@/lib/plans/service";
import {
  canTransitionHangout,
  isHangoutJoinable,
  validateHangoutDuration
} from "@/lib/social/plans";
import { activeHangoutCount } from "@/lib/social/planning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAccess } from "@/lib/access/guard";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import type { HangoutActivityType, HangoutAudienceType, HangoutRequestStatus, SubscriptionPlan } from "@/lib/supabase/database.types";

export type HangoutActionState = {
  ok: boolean;
  message: string;
  hangoutId?: string;
  planId?: string;
};

const uuidSchema = z.string().uuid();
type Admin = ReturnType<typeof createSupabaseAdminClient>;

function missingEnvState(): HangoutActionState | null {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    return { ok: false, message: "This action needs the server database configuration." };
  }
  return null;
}

async function getAuthedUserId() {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

async function displayName(admin: Admin, userId: string) {
  const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
  return data?.full_name?.trim() || "A Muddy";
}

/**
 * Server-side eligibility for viewing/joining a hangout session (spec §52).
 * Privacy-critical: block > not-muddies > Ghost Mode > audience narrowing.
 * Ghost Mode ends hangout visibility (recommended default), regardless of
 * audience. Never trusts the client's claim of eligibility.
 */
async function canViewHangout(
  admin: Admin,
  viewerId: string,
  session: {
    id: string;
    owner_id: string;
    audience_type: HangoutAudienceType;
  }
): Promise<boolean> {
  if (viewerId === session.owner_id) return true;

  const [mutual, blocked] = await Promise.all([
    areApprovedMuddies(admin, session.owner_id, viewerId),
    isBlockedEitherDirection(admin, session.owner_id, viewerId)
  ]);

  /* A BLOCK ALWAYS WINS, before any audience is considered. */
  if (blocked) return false;

  const { data: profile } = await admin
    .from("profiles")
    .select("visibility_status")
    .eq("user_id", session.owner_id)
    .maybeSingle();
  if (profile?.visibility_status === "ghost") return false;

  /* MUTUAL-MUDDY IS REQUIRED FOR EVERY AUDIENCE EXCEPT GROUPS.
   *
   * It used to be an unconditional gate here, which was right while every
   * audience was a flavour of "my Muddies". A public Group is the first
   * audience that deliberately reaches beyond one social hop: the whole point
   * of posting to a community is that people you have not met can see it.
   *
   * So the requirement moves into the switch rather than being dropped --
   * `selected_groups` proves membership of a genuinely public Group instead,
   * which is a different and equally real relationship. Every other audience
   * still refuses a non-Muddy exactly as before. */
  if (session.audience_type !== "selected_groups" && !mutual) return false;

  switch (session.audience_type) {
    case "all_muddies":
      return true;
    case "close_friends":
      return isCloseFriend(admin, session.owner_id, viewerId);
    case "selected_circles": {
      const circles = await viewerCircleIds(admin, session.owner_id, viewerId);
      if (circles.size === 0) return false;
      const { data: targets } = await admin
        .from("hangout_audience_targets")
        .select("target_id")
        .eq("hangout_session_id", session.id)
        .eq("target_type", "circle");
      return (targets ?? []).some((target) => circles.has(target.target_id));
    }
    case "selected_muddies": {
      const { data: target } = await admin
        .from("hangout_audience_targets")
        .select("id")
        .eq("hangout_session_id", session.id)
        .eq("target_type", "user")
        .eq("target_id", viewerId)
        .maybeSingle();
      return Boolean(target);
    }
    case "selected_groups": {
      /* Visible inside specific PUBLIC Groups the viewer actually belongs to.
       *
       * Three things are checked, and all three matter:
       *   1. the UpFor targets this conversation,
       *   2. the conversation is a group whose visibility is 'public' -- a
       *      private Circle must never become a discovery surface this way,
       *   3. the viewer is a joined member.
       *
       * Membership is checked against the viewer, never inferred from the
       * target list, so targeting a group the viewer cannot see reveals
       * nothing. */
      const { data: targets } = await admin
        .from("hangout_audience_targets")
        .select("target_id")
        .eq("hangout_session_id", session.id)
        .eq("target_type", "group");
      const groupIds = (targets ?? []).map((row) => row.target_id);
      if (groupIds.length === 0) return false;

      const { data: publicGroups } = await admin
        .from("group_settings")
        .select("conversation_id")
        .in("conversation_id", groupIds)
        .eq("visibility", "public");
      const publicIds = (publicGroups ?? []).map((row) => row.conversation_id);
      if (publicIds.length === 0) return false;

      const { data: membership } = await admin
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", viewerId)
        .eq("status", "joined")
        .in("conversation_id", publicIds)
        .limit(1);
      return (membership ?? []).length > 0;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Start / end a session (spec §47, §51, §55)
// ---------------------------------------------------------------------------

const startHangoutSchema = z.object({
  activityType: z.enum(["food", "study", "sports", "gym", "walk", "gaming", "chill", "anything"]),
  message: z.string().max(140).optional(),
  audienceType: z.enum(["all_muddies", "close_friends", "selected_circles", "selected_muddies"]),
  broadAreaText: z.string().max(80).optional(),
  /**
   * The creator's visibility choice. Defaults to the private answer, so a
   * client that omits it can never widen a session by accident.
   *
   * Note what is NOT accepted here: an area tier. Proximity is derived
   * server-side from the canonical engine — a client that could submit its
   * own tier could claim to be "close by" to everyone.
   */
  discoveryScope: z.enum(["muddies", "nearby"]).default("muddies"),
  endsAt: z.string().datetime({ offset: true }),
  maxParticipants: z.number().int().min(1).max(50).optional(),
  allowPings: z.boolean().optional(),
  allowFriendInvites: z.boolean().optional(),
  circleIds: z.array(uuidSchema).max(50).optional(),
  muddyIds: z.array(uuidSchema).max(50).optional()
});

/**
 * UpFor limits, flat for everybody who has Access.
 *
 * These replace `max_active_hangouts` / `max_hangout_capacity`, which varied by
 * subscription tier. They are anti-abuse ceilings, not a paywall: a limit that
 * can be raised by paying is a quota, and the access model sells one boundary
 * rather than quotas. The values are the old paid-tier ones, so nobody who
 * previously had Access loses capability.
 */
const MAX_ACTIVE_UPFORS = 3;
const MAX_UPFOR_CAPACITY = 50;
const DEFAULT_UPFOR_CAPACITY = 5;

export async function startHangoutAction(input: unknown): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;

  const parsed = startHangoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the UpFor details and try again." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  /* GATED: creating an UpFor is the expansion act -- it publishes an
     invitation, potentially to people you have not met. */
  const access = await checkAccess(userId, "upfor");
  if (!access.ok) return { ok: false, message: access.message };

  const nowMs = Date.now();
  const endsMs = Date.parse(parsed.data.endsAt);
  const durationError = validateHangoutDuration(nowMs, endsMs);
  if (durationError) return { ok: false, message: durationError };

  const rateLimit = await consumeRateLimit({ action: "hangouts.start", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  const admin = createSupabaseAdminClient();

  /* THE OLD TIER CAPS ARE GONE FROM HERE.
   *
   * This used to read `getCurrentSubscriptionAccess(userId).plan` and cap
   * active UpFors and capacity per tier (3 / 5 on free), with an
   * "on your plan" upgrade prompt. That is the three-tier model the access
   * reset replaces: UpFor is now ONE boundary -- you either have Mad Buddy
   * Access or you do not -- and the check above already decided that.
   *
   * A person with Access gets the full capability rather than a metered
   * version of it, which is the difference between selling a feature and
   * selling a quota.
   *
   * The concurrency ceiling below is NOT monetization: it is the same
   * anti-abuse limit for everybody with Access, so one account cannot flood
   * the nearby feed with sessions. Being flat, it cannot be bought past. */
  if ((await activeHangoutCount(admin, userId)) >= MAX_ACTIVE_UPFORS) {
    return {
      ok: false,
      message: `You can have up to ${MAX_ACTIVE_UPFORS} UpFors running at once. End one to start another.`
    };
  }

  const requestedCapacity = parsed.data.maxParticipants ?? DEFAULT_UPFOR_CAPACITY;
  if (requestedCapacity > MAX_UPFOR_CAPACITY) {
    return { ok: false, message: `An UpFor can include up to ${MAX_UPFOR_CAPACITY} people.` };
  }

  /**
   * Coarse area, derived HERE from the creator's own location row.
   *
   * The client never sends a tier. It sends an activity and a duration; the
   * band comes from the same confidence model Linkr uses, and the coordinates
   * are read, converted and discarded inside this block.
   *
   * FALLBACK, stated explicitly: no location row, or one older than the
   * freshness window, yields tier = null and derivedAt = null. Creation still
   * succeeds — being unable to place someone is not a reason to stop them
   * telling their Muddies they are free — but the session carries no proximity
   * claim, and `discovery_scope` falls back to 'muddies' below, because a
   * session nobody can be matched against has no business being offered to
   * strangers.
   */
  const derivedArea = await (async () => {
    const nowIso = new Date().toISOString();
    const { data: location } = await admin
      .from("user_locations")
      .select("confidence, last_updated")
      .eq("user_id", userId)
      .maybeSingle();

    if (!location || !isLocationFreshEnough(location.last_updated, Date.now())) {
      return { tier: null as SocializeAreaTier | null, derivedAt: null as string | null };
    }

    // The creator's OWN position, so the band describes the area they are in
    // rather than a distance to any particular viewer. Viewer-relative
    // proximity is computed per request in the discovery path — storing one
    // viewer's answer as universal truth is exactly the mistake this avoids.
    return {
      tier: confidenceToAreaTier(location.confidence),
      derivedAt: nowIso
    };
  })();

  const { data: session, error } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: userId,
      activity_type: parsed.data.activityType as HangoutActivityType,
      message: parsed.data.message?.trim() || null,
      audience_type: parsed.data.audienceType as HangoutAudienceType,
      broad_area_text: parsed.data.broadAreaText?.trim() || null,
      area_tier: derivedArea.tier,
      area_derived_at: derivedArea.derivedAt,
      // A session can only be nearby-discoverable if we actually know where
      // its creator is. Falling back to 'muddies' rather than publishing a
      // session nobody can be matched against — and rather than silently
      // widening one we cannot place.
      discovery_scope: derivedArea.tier === null ? "muddies" : parsed.data.discoveryScope,
      ends_at: parsed.data.endsAt,
      max_participants: requestedCapacity,
      allow_pings: parsed.data.allowPings ?? true,
      allow_friend_invites: parsed.data.allowFriendInvites ?? false,
      status: "active"
    })
    .select("id")
    .single();
  if (error || !session) return { ok: false, message: "Couldn't start your UpFor." };

  // Audience targets for narrowed audiences (owned circles / eligible muddies).
  if (parsed.data.audienceType === "selected_circles" && parsed.data.circleIds?.length) {
    const { data: ownedCircles } = await admin
      .from("friend_circles")
      .select("id")
      .eq("user_id", userId)
      .is("archived_at", null)
      .in("id", parsed.data.circleIds);
    const rows = (ownedCircles ?? []).map((circle) => ({
      hangout_session_id: session.id,
      target_type: "circle" as const,
      target_id: circle.id
    }));
    if (rows.length > 0) await admin.from("hangout_audience_targets").insert(rows);
  } else if (parsed.data.audienceType === "selected_muddies" && parsed.data.muddyIds?.length) {
    const eligible = [...(await batchEligibleMuddyIds(admin, userId, parsed.data.muddyIds))];
    if (eligible.length > 0) {
      await admin.from("hangout_audience_targets").insert(
        eligible.map((muddyId) => ({
          hangout_session_id: session.id,
          target_type: "user" as const,
          target_id: muddyId
        }))
      );
    }
  }

  // Notify the destined audience so they can show interest (request to join),
  // which the host then accepts. Bounded fan-out; blocked users excluded.
  const recipients = await resolveHangoutAudience(admin, userId, {
    audienceType: parsed.data.audienceType,
    circleIds: parsed.data.circleIds,
    muddyIds: parsed.data.muddyIds
  });
  if (recipients.length > 0) {
    const name = await displayName(admin, userId);
    const note = parsed.data.message?.trim();
    await Promise.all(
      recipients.map((recipientId) =>
        deliverNotification(admin, {
          userId: recipientId,
          senderId: userId,
          category: "plans",
          type: `hangout:${session.id}`,
          title: "A Muddy is open to hang out",
          message: note ? `${name} is open to hang out: “${note}”` : `${name} is open to hang out. Tap to show interest.`
        })
      )
    );
  }

  // Note: the host appears in every eligible viewer's "Muddies open to plans"
  // through getVisibleHangoutsAction, which enforces each hangout's own audience
  // (all-Muddies, Close Friends, circles, selected). No status mirroring is
  // needed, so a narrower audience is never widened.

  return { ok: true, message: "You're open to hang out.", hangoutId: session.id };
}

/**
 * Resolves the Muddies who should be notified about a new hangout, scoped to
 * its audience. Only approved muddies of the host are eligible; blocked users
 * and the host are excluded, and the fan-out is capped.
 */
async function resolveHangoutAudience(
  admin: Admin,
  ownerId: string,
  input: { audienceType: HangoutAudienceType; circleIds?: string[]; muddyIds?: string[] }
): Promise<string[]> {
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${ownerId},user_two_id.eq.${ownerId}`)
    .is("ended_at", null);
  const friendIds = new Set(
    (friendships ?? []).map((row) => (row.user_one_id === ownerId ? row.user_two_id : row.user_one_id))
  );
  if (friendIds.size === 0) return [];

  const { data: blocks } = await admin
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${ownerId},blocked_id.eq.${ownerId}`);
  const blocked = new Set((blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id]));

  let candidates: string[] = [];
  switch (input.audienceType) {
    case "all_muddies":
      candidates = [...friendIds];
      break;
    case "close_friends": {
      const { data } = await admin.from("close_friend_relationships").select("friend_id").eq("owner_id", ownerId);
      candidates = (data ?? []).map((row) => row.friend_id);
      break;
    }
    case "selected_circles": {
      const circleIds = input.circleIds ?? [];
      if (circleIds.length === 0) break;
      // Only circles the host actually owns.
      const { data: owned } = await admin.from("friend_circles").select("id").eq("user_id", ownerId).in("id", circleIds);
      const ownedIds = (owned ?? []).map((row) => row.id);
      if (ownedIds.length === 0) break;
      const { data: members } = await admin.from("circle_members").select("friend_id").in("circle_id", ownedIds);
      candidates = (members ?? []).map((row) => row.friend_id);
      break;
    }
    case "selected_muddies":
      candidates = input.muddyIds ?? [];
      break;
  }

  return [...new Set(candidates)]
    .filter((id) => id !== ownerId && friendIds.has(id) && !blocked.has(id))
    .slice(0, 200);
}

export async function endHangoutAction(hangoutId: string): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "UpFor not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("hangout_sessions")
    .select("status, owner_id")
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, message: "UpFor not found." };
  if (session.owner_id !== userId) return { ok: false, message: "This isn't your UpFor." };
  if (!canTransitionHangout(session.status, "cancelled")) {
    return { ok: false, message: "This UpFor is already over." };
  }

  await admin
    .from("hangout_sessions")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", hangoutId)
    .eq("owner_id", userId);

  return { ok: true, message: "UpFor ended." };
}

// ---------------------------------------------------------------------------
// Discovery feed (spec §49), hangouts the viewer may see and ask to join.
// ---------------------------------------------------------------------------

/**
 * One accepted participant, for the detail sheet's avatar stack.
 *
 * Public profile fields only — the same name and photo already shown wherever
 * this person appears. No email, no plan, no request state: who is coming is
 * the question, not what their membership looks like.
 */
export type HangoutParticipant = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

export type VisibleHangout = {
  id: string;
  /**
   * Coarse band, or null when the creator's position was unknown or too old.
   * Null is rendered as silence, never as "far".
   */
  areaTier: SocializeAreaTier | null;
  /** The owner's id, so the viewer can tell their own UpFor from another's. */
  ownerId: string;
  ownerName: string;
  /** Links the creator to their canonical profile. */
  ownerUsername: string;
  /** The owner's photo. Already public wherever their name is shown. */
  ownerAvatarUrl: string | null;
  ownerPlan: SubscriptionPlan;
  activityType: HangoutActivityType;
  message: string | null;
  broadAreaText: string | null;
  endsAt: string;
  allowPings: boolean;
  myRequestStatus: string | null;
  /** When it began. Server-authoritative; the client only formats it. */
  startsAt: string;
  /**
   * Accepted participants, excluding the owner.
   *
   * Loaded in the SAME grouped read the count already used, plus one batched
   * profile query for every participant across every session — never one
   * query per card, and never one per person.
   */
  participants: HangoutParticipant[];
  /**
   * The cap the owner set, so "Has space" compares against a real limit
   * rather than inferring capacity from how many people happened to ask.
   */
  maxParticipants: number;
  /**
   * Accepted joiners, plus the owner.
   *
   * Counted from `hangout_requests`, which already exists — this is not a new
   * signal, only one that was computed and thrown away. Pending requests are
   * NOT counted: "3 going" must mean three people are actually coming, not
   * three people who asked.
   */
  goingCount: number;
  /**
   * Whether the viewer and the creator are approved Muddies.
   *
   * SERVER-DERIVED, and it has to be. The Muddies tab decides what a person
   * sees, so letting the client infer a friendship from ids in a payload would
   * make the filter a suggestion rather than a rule. Read once for the whole
   * feed, never per card.
   */
  isMuddy: boolean;
  /**
   * Whether this UpFor reached the viewer through a public Group they belong
   * to.
   *
   * Only ever true for a group the viewer is a JOINED member of and whose
   * visibility is public -- the same three-part check canViewHangout applies.
   * It says "you may see this through a group", never which group: naming it
   * would disclose a membership the viewer may not share with the creator.
   */
  viaGroup: boolean;
};

/**
 * Active hangouts from the viewer's Muddies, filtered through the same
 * server-side eligibility as everything else (block > not-muddies > Ghost
 * Mode > audience narrowing). Broad area text only, never location.
 */
/**
 * The columns discovery reads. One constant, so the two paths cannot drift
 * into selecting different shapes.
 *
 * Note what is absent: no coordinates, and no location row at all. Proximity
 * is computed from a separate read that never leaves this module.
 */
const HANGOUT_DISCOVERY_COLUMNS =
  "id, owner_id, activity_type, message, broad_area_text, starts_at, ends_at, allow_pings, audience_type, status, max_participants, area_tier, area_derived_at, discovery_scope";

type HangoutDiscoveryRow = {
  id: string;
  owner_id: string;
  activity_type: HangoutActivityType;
  message: string | null;
  broad_area_text: string | null;
  starts_at: string;
  ends_at: string;
  allow_pings: boolean;
  audience_type: HangoutAudienceType;
  status: string;
  max_participants: number;
  area_tier: string | null;
  area_derived_at: string | null;
  discovery_scope: string;
};

/**
 * Which opted-in sessions a stranger may actually see.
 *
 * Proximity is computed HERE, per viewer, through the canonical Linkr engine.
 * The row's stored `area_tier` describes how precisely we know where its
 * creator is — it is NOT a distance to this viewer, and using it for
 * authorization would make one person's answer everybody's.
 *
 * Coordinates are read into this function and never leave it: what returns is
 * a filtered list of session rows, and `buildSafeNearbyFriends` is the same
 * helper whose output is guarded against location-shaped keys elsewhere.
 *
 * FAIL-CLOSED throughout. No viewer location, no creator location, a stale
 * either side, a block, ghost mode, a restriction, or a proximity level too
 * wide — each returns nothing for that session.
 */
async function filterStrangerDiscoverable(
  admin: Admin,
  viewerId: string,
  candidates: HangoutDiscoveryRow[]
): Promise<HangoutDiscoveryRow[]> {
  const nowMs = Date.now();

  const { data: viewerLocation } = await admin
    .from("user_locations")
    .select("latitude, longitude, confidence, last_updated")
    .eq("user_id", viewerId)
    .maybeSingle();

  // No position of the viewer's own means nothing to compare against, and
  // "nearby" would be meaningless rather than merely unknown.
  if (!viewerLocation || !isLocationFreshEnough(viewerLocation.last_updated, nowMs)) return [];

  const ownerIds = [...new Set(candidates.map((session) => session.owner_id))];

  const [{ data: locations }, { data: profiles }, { data: blocks }] = await Promise.all([
    admin
      .from("user_locations")
      .select("user_id, latitude, longitude, confidence, last_updated")
      .in("user_id", ownerIds),
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url, visibility_status")
      .in("user_id", ownerIds),
    admin
      .from("blocked_users")
      .select("blocker_id, blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`)
  ]);

  const locationByUserId = new Map(
    ((locations ?? []) as NearbyLocationRow[]).map((row) => [row.user_id, row])
  );
  const profileByUserId = new Map(
    ((profiles ?? []) as NearbyProfileRow[]).map((row) => [row.user_id, row])
  );
  const blockedIds = new Set(
    (blocks ?? []).flatMap((row) => [row.blocker_id, row.blocked_id])
  );

  /**
   * Viewer-relative proximity, from the canonical engine.
   *
   * `buildSafeNearbyFriends` already drops blocked users, ghost profiles and
   * stale positions, and returns coarse levels only — no distance. Reused
   * rather than reimplemented so UpFor and Linkr agree on what "close" means.
   */
  const safe = buildSafeNearbyFriends({
    viewer: viewerLocation,
    friendIds: ownerIds,
    blockedIds,
    premiumUserIds: new Set(),
    locationByUserId,
    profileByUserId,
    now: nowMs
  });
  const levelByOwner = new Map(safe.map((entry) => [entry.friend_id, entry.proximity_level]));

  const results: HangoutDiscoveryRow[] = [];
  for (const session of candidates) {
    const profile = profileByUserId.get(session.owner_id);
    const location = locationByUserId.get(session.owner_id);
    // The "plans" surface, which is where hangout notifications already
    // route and the nearest existing restriction scope. No new surface is
    // invented here: a suspended user must not reach strangers, and reusing
    // the existing enforcement is how that stays true without a second list
    // of what counts as restricted.
    const guard = await guardAction(admin, { userId: session.owner_id, surface: "plans" });

    const allowed = canStrangerDiscoverUpFor({
      discoveryScope: session.discovery_scope,
      sessionStatus: session.status,
      endsAt: session.ends_at,
      creatorLocationUpdatedAt: location?.last_updated ?? null,
      viewerHasLocation: true,
      blockedEitherWay: blockedIds.has(session.owner_id),
      creatorVisibilityStatus: profile?.visibility_status ?? null,
      creatorRestricted: !guard.allowed,
      proximityLevel: levelByOwner.get(session.owner_id) ?? null,
      nowMs
    });

    if (allowed) results.push(session);
  }

  return results;
}

export async function getVisibleHangoutsAction(): Promise<VisibleHangout[]> {
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return [];
  const userId = await getAuthedUserId();
  if (!userId) return [];

  const admin = createSupabaseAdminClient();
  const { data: friendships } = await admin
    .from("friendships")
    .select("user_one_id, user_two_id")
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .is("ended_at", null);
  const friendIds = (friendships ?? []).map((row) =>
    row.user_one_id === userId ? row.user_two_id : row.user_one_id
  );
  // NOT an early return on an empty friend list. A viewer with no Muddies can
  // still discover opted-in nearby sessions, and returning here would have
  // silently made stranger discovery a Muddies-only feature.
  const nowIso = new Date().toISOString();

  const [{ data: muddySessions }, { data: nearbySessions }] = await Promise.all([
    friendIds.length > 0
      ? admin
          .from("hangout_sessions")
          .select(HANGOUT_DISCOVERY_COLUMNS)
          .in("owner_id", friendIds)
          .eq("status", "active")
          .gt("ends_at", nowIso)
          .order("ends_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as HangoutDiscoveryRow[] }),
    // Sessions whose creator explicitly opted in. Owners other than the
    // viewer, and other than the viewer's Muddies — those already came back
    // through the path above, and re-reading them here would be wasted work
    // before the dedupe.
    admin
      .from("hangout_sessions")
      .select(HANGOUT_DISCOVERY_COLUMNS)
      .eq("discovery_scope", "nearby")
      .eq("status", "active")
      .gt("ends_at", nowIso)
      .neq("owner_id", userId)
      .order("ends_at", { ascending: true })
      .limit(50)
  ]);

  const muddyRows = (muddySessions ?? []) as HangoutDiscoveryRow[];

  /* THE GATE SITS BETWEEN THE TWO HALVES OF THIS FEED, not around it.
   *
   * The query above has two branches, and they are different products under
   * the access model:
   *
   *   muddySessions    what your EXISTING Muddies are up for. That is your
   *                    existing social world, which is free forever. Gating it
   *                    would paywall seeing your own friends -- exactly the
   *                    accidental over-gating the constitution warns about.
   *
   *   nearbySessions   `discovery_scope: "nearby"` sessions from people who
   *                    are NOT your Muddies. That is expansion, and it is what
   *                    Mad Buddy Access pays for.
   *
   * So an expired account keeps a working UpFor feed of its own Muddies and
   * simply stops seeing strangers in it. */
  const upforAccess = await checkAccess(userId, "upfor");
  const strangerCandidates = upforAccess.ok
    ? ((nearbySessions ?? []) as HangoutDiscoveryRow[]).filter(
        (session) => !friendIds.includes(session.owner_id)
      )
    : [];

  const visible: HangoutDiscoveryRow[] = [];

  // MUDDIES PATH, unchanged. Same gate, same order, same results.
  for (const session of muddyRows) {
    if (await canViewHangout(admin, userId, session)) visible.push(session);
  }

  // STRANGER PATH. Every gate in canStrangerDiscoverUpFor must pass, and
  // proximity is computed per viewer rather than read off the row.
  if (strangerCandidates.length > 0) {
    const eligible = await filterStrangerDiscoverable(admin, userId, strangerCandidates);
    // Dedupe by id: an UpFor can qualify through both paths if its owner
    // became a Muddy after opting in, and it must appear exactly once.
    const seen = new Set(visible.map((session) => session.id));
    for (const session of eligible) {
      if (!seen.has(session.id)) {
        seen.add(session.id);
        visible.push(session);
      }
    }
  }

  if (visible.length === 0) return [];

  // ONE canonical ordering across both paths: soonest to end first, so the
  // thing you are most likely to miss is at the top. Applied after the merge,
  // because two separately-sorted lists concatenated are not sorted.
  visible.sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at));

  const ownerIds = [...new Set(visible.map((session) => session.owner_id))];
  const [{ data: owners }, { data: myRequests }, plans] = await Promise.all([
    admin
      .from("profiles")
      .select("user_id, full_name, username, avatar_url")
      .in("user_id", ownerIds),
    admin
      .from("hangout_requests")
      .select("hangout_session_id, status")
      .eq("requester_id", userId)
      .in(
        "hangout_session_id",
        visible.map((session) => session.id)
      ),
    loadEffectivePlansForUsers(admin, ownerIds)
  ]);
  const profileById = new Map((owners ?? []).map((row) => [row.user_id, row]));
  const requestBySession = new Map((myRequests ?? []).map((row) => [row.hangout_session_id, row.status]));

  // Accepted joiners per session. One grouped read rather than a query per
  // card, and accepted-only so the count never overstates who is coming.
  const { data: acceptedRows } = await admin
    .from("hangout_requests")
    .select("hangout_session_id, requester_id")
    .eq("status", "accepted")
    .in(
      "hangout_session_id",
      visible.map((session) => session.id)
    );
  const acceptedBySession = new Map<string, number>();
  const participantIdsBySession = new Map<string, string[]>();
  for (const row of acceptedRows ?? []) {
    acceptedBySession.set(row.hangout_session_id, (acceptedBySession.get(row.hangout_session_id) ?? 0) + 1);
    const ids = participantIdsBySession.get(row.hangout_session_id) ?? [];
    ids.push(row.requester_id);
    participantIdsBySession.set(row.hangout_session_id, ids);
  }

  // ONE profile read for every participant across every session. A query per
  // card — or worse, per person — is the N+1 this deliberately avoids.
  const participantIds = [...new Set((acceptedRows ?? []).map((row) => row.requester_id))];
  const { data: participantProfiles } = participantIds.length
    ? await admin
        .from("profiles")
        .select("user_id, full_name, username, avatar_url")
        .in("user_id", participantIds)
    : { data: [] };
  const participantById = new Map((participantProfiles ?? []).map((row) => [row.user_id, row]));

  /* RELATIONSHIP AND GROUP CONTEXT, in two batched reads.
   *
   * The discovery modes need to know how each UpFor reached this viewer.
   * Deriving it here keeps that answer on the server: `filterForMode` narrows
   * an already-eligible list, so these flags order and group what the viewer
   * may already see -- they are not a second access check, and nothing is
   * exposed that canViewHangout did not already allow. */
  const ownerIdsForContext = [...new Set(visible.map((session) => session.owner_id))];
  const muddyOwnerIds = new Set<string>();
  await Promise.all(
    ownerIdsForContext.map(async (ownerId) => {
      if (ownerId === userId) return;
      if (await areApprovedMuddies(admin, ownerId, userId)) muddyOwnerIds.add(ownerId);
    })
  );

  /* Which sessions are reachable through a public Group the viewer has
   * joined. One read for the viewer's joined conversations, one for the
   * targets, intersected in memory -- never a per-card query, and never a
   * claim about a group the viewer is not in. */
  const groupSessionIds = new Set<string>();
  {
    const { data: joined } = await admin
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("status", "joined");
    const joinedIds = (joined ?? []).map((row) => row.conversation_id);
    if (joinedIds.length > 0) {
      const { data: publicGroups } = await admin
        .from("group_settings")
        .select("conversation_id")
        .in("conversation_id", joinedIds)
        .eq("visibility", "public");
      const publicJoinedIds = (publicGroups ?? []).map((row) => row.conversation_id);
      if (publicJoinedIds.length > 0) {
        const { data: targets } = await admin
          .from("hangout_audience_targets")
          .select("hangout_session_id, target_id")
          .eq("target_type", "group")
          .in("hangout_session_id", visible.map((session) => session.id))
          .in("target_id", publicJoinedIds);
        for (const row of targets ?? []) groupSessionIds.add(row.hangout_session_id);
      }
    }
  }

  return visible.map((session) => ({
    id: session.id,
    ownerId: session.owner_id,
    isMuddy: muddyOwnerIds.has(session.owner_id),
    viaGroup: groupSessionIds.has(session.id),
    // Aged out rather than presented as current: a tier is a claim about now,
    // and a stale one would keep saying "Close by" long after it stopped
    // being true. The creator's own area TEXT survives, because that is a
    // statement about a place rather than about this moment.
    areaTier: isLocationFreshEnough(session.area_derived_at, Date.now())
      ? ((session.area_tier as SocializeAreaTier | null) ?? null)
      : null,
    ownerName: profileById.get(session.owner_id)?.full_name?.trim() || "A Muddy",
    ownerUsername: profileById.get(session.owner_id)?.username ?? "",
    ownerAvatarUrl: profileById.get(session.owner_id)?.avatar_url ?? null,
    ownerPlan: plans.get(session.owner_id) ?? "free",
    activityType: session.activity_type,
    message: session.message,
    broadAreaText: session.broad_area_text,
    endsAt: session.ends_at,
    allowPings: session.allow_pings,
    myRequestStatus: requestBySession.get(session.id) ?? null,
    startsAt: session.starts_at,
    participants: (participantIdsBySession.get(session.id) ?? [])
      .map((id) => {
        const profile = participantById.get(id);
        // A deleted account leaves its request row behind briefly. Dropped
        // rather than rendered as a nameless avatar.
        if (!profile) return null;
        return {
          userId: id,
          displayName: profile.full_name?.trim() || profile.username,
          username: profile.username,
          avatarUrl: profile.avatar_url
        };
      })
      .filter((participant): participant is HangoutParticipant => participant !== null),
    maxParticipants: session.max_participants,
    // +1 for the owner, who is by definition going to their own hangout.
    goingCount: (acceptedBySession.get(session.id) ?? 0) + 1
  }));
}

// ---------------------------------------------------------------------------
// Join requests (spec §49, §55, §56)
// ---------------------------------------------------------------------------

/**
 * May this stranger request to join an opted-in UpFor?
 *
 * The same gates the discovery path applies, re-evaluated at write time
 * against fresh reads. Deliberately a separate function from the feed's
 * batched filter: that one answers "which of these fifty may be shown", this
 * one answers "may this one person join this one session right now", and
 * conflating them would make the write depend on list-shaped machinery.
 *
 * Fails closed on every unknown, exactly like the feed.
 */
async function canStrangerJoinUpFor(
  admin: Admin,
  viewerId: string,
  session: { owner_id: string; status: string; ends_at: string; discovery_scope?: string }
): Promise<boolean> {
  if (session.discovery_scope !== "nearby") return false;

  const nowMs = Date.now();
  const [{ data: viewerLocation }, { data: ownerLocation }, { data: profile }, blocked, guard] =
    await Promise.all([
      admin
        .from("user_locations")
        .select("latitude, longitude, confidence, last_updated")
        .eq("user_id", viewerId)
        .maybeSingle(),
      admin
        .from("user_locations")
        .select("user_id, latitude, longitude, confidence, last_updated")
        .eq("user_id", session.owner_id)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("user_id, full_name, username, avatar_url, visibility_status")
        .eq("user_id", session.owner_id)
        .maybeSingle(),
      isBlockedEitherDirection(admin, session.owner_id, viewerId),
      guardAction(admin, { userId: session.owner_id, surface: "plans" })
    ]);

  if (!viewerLocation || !ownerLocation || !profile) return false;
  if (!isLocationFreshEnough(viewerLocation.last_updated, nowMs)) return false;

  // Proximity through the canonical engine, so join and discovery agree on
  // what "near" means rather than each deciding for itself.
  const safe = buildSafeNearbyFriends({
    viewer: viewerLocation,
    friendIds: [session.owner_id],
    blockedIds: new Set(blocked ? [session.owner_id] : []),
    premiumUserIds: new Set(),
    locationByUserId: new Map([[session.owner_id, ownerLocation as NearbyLocationRow]]),
    profileByUserId: new Map([[session.owner_id, profile as NearbyProfileRow]]),
    now: nowMs
  });

  return canStrangerDiscoverUpFor({
    discoveryScope: session.discovery_scope,
    sessionStatus: session.status,
    endsAt: session.ends_at,
    creatorLocationUpdatedAt: ownerLocation.last_updated,
    viewerHasLocation: true,
    blockedEitherWay: blocked,
    creatorVisibilityStatus: profile.visibility_status,
    creatorRestricted: !guard.allowed,
    proximityLevel: safe[0]?.proximity_level ?? null,
    nowMs
  });
}

export async function requestHangoutAction(
  hangoutId: string,
  message?: string,
  /**
   * How the person is answering.
   *
   * "pending" is asking to join; "maybe" is soft interest. Both use the SAME
   * row and the same unique (session, requester) constraint, so a person has
   * exactly one answer at a time and changing their mind updates it rather
   * than stacking a second request. Only these two are accepted here --
   * "accepted" and "declined" belong to the owner, and letting a requester
   * send them would be a privilege escalation dressed as a parameter.
   */
  intent: "pending" | "maybe" = "pending"
): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "UpFor not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: session } = await admin
    .from("hangout_sessions")
    .select(
      "id, owner_id, audience_type, status, ends_at, max_participants, allow_pings, discovery_scope"
    )
    .eq("id", hangoutId)
    .maybeSingle();
  if (!session) return { ok: false, message: "UpFor not found." };
  if (session.owner_id === userId) return { ok: false, message: "This is your own UpFor." };
  if (!isHangoutJoinable(session.status, Date.parse(session.ends_at), Date.now())) {
    return { ok: false, message: "This UpFor is no longer open." };
  }
  if (!session.allow_pings) return { ok: false, message: "The host isn't taking requests right now." };

  /**
   * Privacy gate. The server decides, never the client.
   *
   * TWO ways in, matching the two discovery paths exactly: a Muddy through
   * the audience rules, or a stranger through the nearby opt-in. Checking
   * only the first meant somebody could see an opted-in UpFor and then be
   * refused when they tapped join — the feature was half-wired.
   *
   * The stranger check re-runs every gate rather than trusting that the
   * viewer got here from a feed. A request is a write, and a write must
   * verify its own preconditions: the session may have been withdrawn, the
   * creator may have moved or gone ghost, or a block may have appeared since
   * the list was rendered.
   */
  const viewableAsMuddy = await canViewHangout(admin, userId, session);
  const viewableAsStranger = viewableAsMuddy
    ? false
    : await canStrangerJoinUpFor(admin, userId, session);

  if (!viewableAsMuddy && !viewableAsStranger) {
    return { ok: false, message: "This UpFor isn't open to you." };
  }

  /* GATED ONLY FOR STRANGERS, and the code above already drew that line.
   *
   * Joining a MUDDY's UpFor is your existing social world -- free forever, and
   * gating it would paywall answering your own friend. Joining a STRANGER's is
   * expansion, which is what Access pays for.
   *
   * `viewableAsMuddy` is checked first and short-circuits, so this branch runs
   * only for people who reached the session through the nearby opt-in. */
  if (viewableAsStranger) {
    const access = await checkAccess(userId, "upfor");
    if (!access.ok) return { ok: false, message: access.message };
  }

  const rateLimit = await consumeRateLimit({ action: "hangouts.request", userId });
  if (!rateLimit.allowed) return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };

  // Capacity: accepted requests must be below the cap (spec §51).
  const { count: acceptedCount } = await admin
    .from("hangout_requests")
    .select("id", { count: "exact", head: true })
    .eq("hangout_session_id", hangoutId)
    .eq("status", "accepted");
  if ((acceptedCount ?? 0) >= session.max_participants) {
    return { ok: false, message: "This UpFor is full." };
  }

  // Idempotent create: the unique constraint (hangout_session_id, requester_id)
  // guarantees one row per requester. A brand-new INSERT is the ONLY path that
  // notifies the owner, so a repeat tap — or a rapid double-click racing on the
  // constraint — can never create a second request or a second notification.
  const { data: inserted, error } = await admin
    .from("hangout_requests")
    .insert({
      hangout_session_id: hangoutId,
      requester_id: userId,
      status: intent,
      message: message?.trim() || null
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique violation: the request already exists. Idempotent success,
    // and no duplicate notification for the same existing request.
    if (error.code === "23505") {
      /* The row already exists. Idempotent for the same answer, and an UPDATE
       * when the person is changing it -- tapping Maybe after I'm in has to
       * move the existing row rather than report success and leave the old
       * answer standing. Scoped to this requester's own row, so this can never
       * touch anybody else's response. */
      const { data: existing } = await admin
        .from("hangout_requests")
        .select("status")
        .eq("hangout_session_id", hangoutId)
        .eq("requester_id", userId)
        .maybeSingle();

      if (existing && existing.status !== intent) {
        // Only a requester-owned state may be moved into; an accepted seat is
        // the owner's decision and is left alone.
        if (existing.status === "pending" || existing.status === "maybe" || existing.status === "cancelled") {
          await admin
            .from("hangout_requests")
            .update({ status: intent, responded_at: null })
            .eq("hangout_session_id", hangoutId)
            .eq("requester_id", userId);
          return {
            ok: true,
            message: intent === "maybe" ? "Marked as maybe." : "You've asked to join.",
            hangoutId
          };
        }
      }
      return {
        ok: true,
        message: intent === "maybe" ? "Marked as maybe." : "You've already asked to join.",
        hangoutId
      };
    }
    return { ok: false, message: "Couldn't send your request. Try again." };
  }
  if (!inserted) return { ok: false, message: "Couldn't send your request. Try again." };

  // The request is persisted. Notification is best-effort from here: a delivery
  // failure must not roll back a valid request (spec §14). Exactly one owner
  // notification for the newly created request, carrying the session id so it
  // opens the right Hangout.
  const name = await displayName(admin, userId);
  await deliverNotification(admin, {
    userId: session.owner_id,
    senderId: userId,
    category: "plans",
    type: `hangout:${hangoutId}`,
    title: "New UpFor request",
    message: `${name} is interested in joining your UpFor.`
  });
  return { ok: true, message: "Request sent.", hangoutId };
}

const respondSchema = z.enum(["accepted", "maybe", "declined"]);

export async function respondHangoutRequestAction(
  requestId: string,
  response: string
): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(requestId).success) return { ok: false, message: "Request not found." };

  const parsedResponse = respondSchema.safeParse(response);
  if (!parsedResponse.success) return { ok: false, message: "Choose accept, maybe, or decline." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();
  const { data: request } = await admin
    .from("hangout_requests")
    .select("id, hangout_session_id, requester_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { ok: false, message: "Request not found." };

  const { data: session } = await admin
    .from("hangout_sessions")
    .select("owner_id, max_participants")
    .eq("id", request.hangout_session_id)
    .maybeSingle();
  if (!session) return { ok: false, message: "UpFor not found." };
  if (session.owner_id !== userId) return { ok: false, message: "Only the host can respond." };

  // Enforce capacity at the moment of acceptance (spec §56 concurrency).
  if (parsedResponse.data === "accepted") {
    const { count: acceptedCount } = await admin
      .from("hangout_requests")
      .select("id", { count: "exact", head: true })
      .eq("hangout_session_id", request.hangout_session_id)
      .eq("status", "accepted");
    if ((acceptedCount ?? 0) >= session.max_participants) {
      return { ok: false, message: "This UpFor is already full." };
    }
  }

  const { error } = await admin
    .from("hangout_requests")
    .update({ status: parsedResponse.data, responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) return { ok: false, message: "Couldn't respond to the request." };

  await deliverNotification(admin, {
    userId: request.requester_id,
    senderId: userId,
    category: "plans",
    type: `hangout:${request.hangout_session_id}`,
    title: "Hangout update",
    message:
      parsedResponse.data === "accepted"
        ? "You're in, the host accepted your request."
        : parsedResponse.data === "maybe"
          ? "The host marked your request as Maybe."
          : "The host can't make this one."
  });
  return { ok: true, message: "Response sent." };
}

// ---------------------------------------------------------------------------
// Convert to plan (spec §49 accept → §54 convert-to-plan)
// ---------------------------------------------------------------------------

export async function convertHangoutToPlanAction(
  hangoutId: string,
  title?: string
): Promise<HangoutActionState> {
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "UpFor not found." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  return convertHangoutToPlan(userId, hangoutId, title);
}

// ---------------------------------------------------------------------------
// Canonical owner request refetch — the single source of truth for the owner's
// "Requests to join" list and count. Used to update the owner's view live
// (polling / focus) and after the owner's own actions, so the count is always
// re-derived from the database rather than from client-side arithmetic.
// ---------------------------------------------------------------------------

export type OwnerHangoutRequest = {
  id: string;
  requesterName: string;
  status: HangoutRequestStatus;
  message: string | null;
};
export type OwnerHangoutRequestsState = {
  hangoutId: string | null;
  requests: OwnerHangoutRequest[];
};

export async function getOwnerHangoutRequestsAction(): Promise<OwnerHangoutRequestsState> {
  const empty: OwnerHangoutRequestsState = { hangoutId: null, requests: [] };
  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) return empty;

  const userId = await getAuthedUserId();
  if (!userId) return empty;

  const admin = createSupabaseAdminClient();
  // The owner is resolved from the session record (owner_id = the authed user),
  // never from the client — so this can only ever return the caller's own
  // Hangout requests and never leaks requests from an unrelated Hangout.
  const { data: session } = await admin
    .from("hangout_sessions")
    .select("id")
    .eq("owner_id", userId)
    .in("status", ["active", "paused", "full"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!session) return empty;

  const { data: rows } = await admin
    .from("hangout_requests")
    .select("id, requester_id, status, message, created_at")
    .eq("hangout_session_id", session.id)
    .order("created_at", { ascending: true });

  const requesterIds = [...new Set((rows ?? []).map((row) => row.requester_id))];
  const nameById = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("user_id, full_name").in("user_id", requesterIds);
    for (const profile of profiles ?? []) nameById.set(profile.user_id, profile.full_name?.trim() || "A Muddy");
  }

  return {
    hangoutId: session.id,
    requests: (rows ?? []).map((row) => ({
      id: row.id,
      requesterName: nameById.get(row.requester_id) ?? "A Muddy",
      status: row.status,
      message: row.message
    }))
  };
}

/**
 * Withdraw from an UpFor: cancel a pending request, or leave after accepting.
 *
 * One action for both, because they are the same transition of the same row.
 * `hangout_requests` already models participation — pending is "I asked",
 * accepted is "I am going" — so leaving is a third state, not a second table.
 *
 * IDEMPOTENT. The update is scoped to rows still in ('pending','accepted'), so
 * a repeat call simply matches nothing and reports success. A user who taps
 * Leave twice, or whose first tap succeeded but whose response was lost, must
 * not see an error for a state the product is already in.
 *
 * NEUTRAL FAILURES. Every refusal returns the same shape regardless of cause —
 * blocked, unfriended, expired, or never a member. Distinguishing them would
 * let anyone probe why access ended, which is exactly the information the
 * privacy model withholds.
 *
 * The owner cannot use this to end their own UpFor: they have no request row,
 * so nothing matches. `endHangoutAction` remains the only way to end one, and
 * it is deliberately separate — leaving is a participant action, ending is an
 * ownership decision that affects everyone.
 */
export async function leaveHangoutAction(hangoutId: string): Promise<HangoutActionState> {
  const missing = missingEnvState();
  if (missing) return missing;
  if (!uuidSchema.safeParse(hangoutId).success) return { ok: false, message: "Not available." };

  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, message: "Log in first." };

  const admin = createSupabaseAdminClient();

  // Scoped to the caller's own row AND to states that can still be withdrawn.
  // A declined row is the owner's decision and is not the requester's to
  // rewrite; an already-cancelled one is a no-op by construction.
  const { data: updated, error } = await admin
    .from("hangout_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("hangout_session_id", hangoutId)
    .eq("requester_id", userId)
    .in("status", ["pending", "accepted"])
    .select("id");

  if (error) return { ok: false, message: "Couldn't update that. Try again." };

  // Zero rows means there was nothing to withdraw — already cancelled, or
  // never joined. Both are the state the caller asked for, so both succeed:
  // reporting an error here would turn a harmless repeat tap into a failure.
  const left = (updated ?? []).length > 0;

  // The freed seat needs no bookkeeping. Every capacity read counts
  // status = 'accepted', so cancelling releases it immediately and nothing
  // can drift out of step with a stored counter.
  return {
    ok: true,
    message: left ? "You're no longer going." : "You're not going to this.",
    hangoutId
  };
}
