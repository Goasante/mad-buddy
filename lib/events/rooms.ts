import "server-only";

import {
  canManageMembers,
  canSendAnnouncement,
  eventCircleMaxMembersFor,
  isEventCircleWritable,
  resolveJoinEventCircle,
  type JoinCircleReason
} from "@/lib/events/rules";
import { eventCircleMemberCount, liveCheckIn, resolveEventCircleAccess } from "@/lib/events/service";
import { viewerIsEventAdmin } from "@/lib/events/access";
import { loadEffectivePlansForUsers } from "@/lib/billing/service";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventCircleRole, SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Event Rooms server service.
 *
 * "Event Room" is the user-facing name; event_circles is the storage. The
 * translation happens at the surface, never in the schema -- renaming stable
 * production tables for vocabulary consistency is cost without benefit.
 *
 * THIS LAYER SUPPLIES FACTS. Every eligibility decision belongs to the pure
 * rules in lib/events/rules.ts, and every multi-row write belongs to the
 * transactional RPCs in 20260827120000_event_rooms_productization.sql. What
 * lives here is the lookups those two need, and the projections the UI reads.
 */

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type RoomJoinMode = "invite" | "check_in" | "qr" | "community";
export type RoomStatus = "draft" | "open" | "active" | "closing" | "archived" | "deleted";

/**
 * What the Join control may say. Every one of these is a real server answer --
 * the UI never renders a Join button whose mutation cannot complete, so the
 * button's label and the server's decision come from the same place.
 */
export type RoomJoinState =
  | "join"
  | "joined"
  | "full"
  | "needs_invitation"
  | "needs_check_in"
  | "needs_qr"
  | "needs_group"
  | "opens_later"
  | "closed"
  | "archived"
  | "banned";

export type RoomView = {
  id: string;
  eventId: string | null;
  name: string;
  description: string | null;
  joinMode: RoomJoinMode;
  status: RoomStatus;
  memberCount: number;
  maxMembers: number;
  listedInEvent: boolean;
  /** The viewer's role, null when they are not a member. */
  myRole: EventCircleRole | null;
  isMember: boolean;
  /** Host or co-host of this Room, or the Event's host/admin. */
  canManage: boolean;
  canPostNotice: boolean;
  joinState: RoomJoinState;
  conversationId: string | null;
  opensAtMs: number | null;
  /** Groups a community-mode Room admits, so Settings can show the selection. */
  groupTargetIds: string[];
};

const JOIN_STATE_BY_REASON: Record<JoinCircleReason, RoomJoinState> = {
  allowed: "join",
  // A banned person is never told they were banned (spec §59). The Room simply
  // does not offer to admit them, exactly as a closed one would not.
  banned: "closed",
  already_joined: "joined",
  closed: "closed",
  not_open_yet: "opens_later",
  full: "full",
  needs_check_in: "needs_check_in",
  needs_token: "needs_qr",
  needs_invitation: "needs_invitation",
  needs_group_membership: "needs_group"
};

/** One human sentence per refusal. The UI never invents its own wording. */
export function roomJoinStateLabel(state: RoomJoinState): string {
  switch (state) {
    case "join":
      return "Join";
    case "joined":
      return "Joined";
    case "full":
      return "Full";
    case "needs_invitation":
      return "Invite only";
    case "needs_check_in":
      return "Check in first";
    case "needs_qr":
      return "Scan to join";
    case "needs_group":
      return "Group members";
    case "opens_later":
      return "Opens later";
    case "archived":
      return "Archived";
    case "banned":
    case "closed":
    default:
      return "Closed";
  }
}

/**
 * Whether the viewer holds a live invitation to a Room.
 *
 * 'accepted' deliberately does not count: an accepted invitation has already
 * been spent, and someone who accepted and then left needs a fresh one. That
 * is what makes "revoke" mean something.
 */
async function invitedRoomIds(admin: Admin, userId: string, roomIds: string[]): Promise<Set<string>> {
  if (roomIds.length === 0) return new Set();
  const { data } = await admin
    .from("event_circle_invitations")
    .select("event_circle_id")
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .in("event_circle_id", roomIds);
  return new Set((data ?? []).map((row) => row.event_circle_id));
}

/**
 * Which of these Rooms admit the viewer through a Group they are currently in.
 *
 * Membership is read LIVE. Nothing about group eligibility is stored on the
 * Room membership or cached on the user: leaving the Group ends access on the
 * next join attempt, with no sweep required.
 */
async function groupEligibility(
  admin: Admin,
  userId: string,
  roomIds: string[]
): Promise<{ hasTargets: Set<string>; eligible: Set<string>; byRoom: Map<string, string[]> }> {
  const hasTargets = new Set<string>();
  const eligible = new Set<string>();
  const byRoom = new Map<string, string[]>();
  if (roomIds.length === 0) return { hasTargets, eligible, byRoom };

  const { data: targets } = await admin
    .from("event_circle_group_targets")
    .select("event_circle_id, group_conversation_id")
    .in("event_circle_id", roomIds);
  if (!targets || targets.length === 0) return { hasTargets, eligible, byRoom };

  for (const target of targets) {
    hasTargets.add(target.event_circle_id);
    byRoom.set(target.event_circle_id, [
      ...(byRoom.get(target.event_circle_id) ?? []),
      target.group_conversation_id
    ]);
  }

  const groupIds = Array.from(new Set(targets.map((target) => target.group_conversation_id)));
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userId)
    .eq("status", "joined")
    .in("conversation_id", groupIds);

  const myGroups = new Set((memberships ?? []).map((row) => row.conversation_id));
  for (const target of targets) {
    if (myGroups.has(target.group_conversation_id)) eligible.add(target.event_circle_id);
  }
  return { hasTargets, eligible, byRoom };
}

/** Joined-member counts for several Rooms in one round trip. */
async function memberCounts(admin: Admin, roomIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (roomIds.length === 0) return counts;
  const { data } = await admin
    .from("event_circle_members")
    .select("event_circle_id")
    .eq("status", "joined")
    .in("event_circle_id", roomIds);
  for (const row of data ?? []) {
    counts.set(row.event_circle_id, (counts.get(row.event_circle_id) ?? 0) + 1);
  }
  return counts;
}

async function conversationIds(admin: Admin, roomIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (roomIds.length === 0) return map;
  const { data } = await admin
    .from("conversations")
    .select("id, context_id")
    .eq("context_type", "event_circle")
    .in("context_id", roomIds);
  for (const row of data ?? []) {
    if (row.context_id) map.set(row.context_id, row.id);
  }
  return map;
}

/**
 * The Rooms for one Event, projected for one viewer.
 *
 * `includeUnlisted` is for Host Tools, which must show the host every Room they
 * own including the hidden ones. The attendee-facing Event page passes false,
 * so "Show in event" off genuinely removes a Room from the listing.
 *
 * Every join state here is computed by the SAME resolver the join action calls.
 * That is deliberate: it is what makes it impossible for the list to offer a
 * Join the mutation would then refuse.
 */
export async function listEventRooms(
  admin: Admin,
  viewerId: string,
  eventId: string,
  options: { includeUnlisted?: boolean } = {}
): Promise<RoomView[]> {
  const query = admin
    .from("event_circles")
    .select(
      "id, event_id, name, description, join_mode, status, max_members, listed_in_event, opens_at, owner_id"
    )
    .eq("event_id", eventId)
    .neq("status", "deleted")
    .order("created_at", { ascending: true });

  const { data: rooms } = await query;
  if (!rooms || rooms.length === 0) return [];

  const roomIds = rooms.map((room) => room.id);
  const nowMs = Date.now();

  const [counts, invited, groups, conversations, { data: memberships }, isOperator] = await Promise.all([
    memberCounts(admin, roomIds),
    invitedRoomIds(admin, viewerId, roomIds),
    groupEligibility(admin, viewerId, roomIds),
    conversationIds(admin, roomIds),
    admin
      .from("event_circle_members")
      .select("event_circle_id, role, status")
      .eq("user_id", viewerId)
      .in("event_circle_id", roomIds),
    isEventOperator(admin, eventId, viewerId)
  ]);

  const myMembership = new Map(
    (memberships ?? []).map((row) => [row.event_circle_id, row] as const)
  );

  // One check-in lookup for the whole list rather than one per Room: every Room
  // on this page belongs to the same Event, so the answer is identical.
  const hasEventCheckIn = Boolean(await liveCheckIn(admin, viewerId, "event", eventId));

  const views: RoomView[] = [];
  for (const room of rooms) {
    if (!options.includeUnlisted && !room.listed_in_event && room.owner_id !== viewerId) {
      // Unlisted Rooms stay reachable by QR or invitation for people who
      // already hold one; they are simply not advertised here.
      const membership = myMembership.get(room.id);
      if (membership?.status !== "joined") continue;
    }

    const membership = myMembership.get(room.id);
    const memberCount = counts.get(room.id) ?? 0;
    const isOwner = room.owner_id === viewerId;
    const myRole: EventCircleRole | null = isOwner ? "host" : (membership?.role ?? null);
    const isMember = isOwner || membership?.status === "joined";

    const decision = resolveJoinEventCircle({
      status: room.status,
      joinMode: room.join_mode,
      memberStatus: membership?.status ?? null,
      memberCount,
      maxMembers: room.max_members,
      hasEventCheckIn,
      // A listing never carries a token; a QR Room shows "Scan to join" here
      // and is joined by actually scanning.
      hasValidToken: false,
      hasInvitation: invited.has(room.id),
      hasGroupTargets: groups.hasTargets.has(room.id),
      isEligibleGroupMember: groups.eligible.has(room.id),
      opensAtMs: room.opens_at ? Date.parse(room.opens_at) : null,
      nowMs
    });

    let joinState: RoomJoinState = isMember ? "joined" : JOIN_STATE_BY_REASON[decision.reason];
    if (room.status === "archived") joinState = isMember ? "joined" : "archived";

    views.push({
      id: room.id,
      eventId: room.event_id,
      name: room.name,
      description: room.description,
      joinMode: room.join_mode,
      status: room.status,
      memberCount,
      maxMembers: room.max_members,
      listedInEvent: room.listed_in_event,
      myRole,
      isMember,
      canManage: isOwner || myRole === "co_host" || isOperator,
      canPostNotice: Boolean(myRole && canSendAnnouncement(myRole)) || isOwner,
      joinState,
      conversationId: conversations.get(room.id) ?? null,
      opensAtMs: room.opens_at ? Date.parse(room.opens_at) : null,
      groupTargetIds: groups.byRoom.get(room.id) ?? []
    });
  }

  return views;
}

/**
 * One Room, for the Room Detail surface.
 *
 * Returns null when the viewer may not see it at all, so a caller cannot leak
 * a Room's existence by distinguishing "missing" from "forbidden".
 */
export async function getEventRoom(
  admin: Admin,
  viewerId: string,
  roomId: string
): Promise<RoomView | null> {
  const { data: room } = await admin
    .from("event_circles")
    .select("event_id")
    .eq("id", roomId)
    .neq("status", "deleted")
    .maybeSingle();
  if (!room?.event_id) return null;

  const rooms = await listEventRooms(admin, viewerId, room.event_id, { includeUnlisted: true });
  const found = rooms.find((candidate) => candidate.id === roomId) ?? null;
  if (!found) return null;

  // An unlisted Room is visible only to people with standing in it. Listing
  // alone is not the access control; this is.
  if (!found.listedInEvent && !found.isMember && !found.canManage) return null;
  return found;
}

export type RoomMemberView = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: EventCircleRole;
  plan: SubscriptionPlan;
  isMe: boolean;
};

/**
 * The Members tab.
 *
 * Returns display identity ONLY -- name, avatar, role, plan badge. No email,
 * no phone, no location, no check-in time. A Room member list is a list of who
 * is in the room, not a directory of contact details.
 */
export async function listRoomMembers(
  admin: Admin,
  viewerId: string,
  roomId: string
): Promise<RoomMemberView[]> {
  const access = await resolveEventCircleAccess(admin, viewerId, roomId);
  // Non-members do not get to enumerate a Room's membership.
  if (!access.exists || !access.isMember) return [];

  const { data: members } = await admin
    .from("event_circle_members")
    .select("user_id, role")
    .eq("event_circle_id", roomId)
    .eq("status", "joined");
  if (!members || members.length === 0) return [];

  const userIds = members.map((member) => member.user_id);
  const [{ data: profiles }, plans] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, avatar_url").in("user_id", userIds),
    loadEffectivePlansForUsers(admin, userIds)
  ]);

  const byId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile] as const));
  const rank: Record<EventCircleRole, number> = { host: 0, co_host: 1, moderator: 2, member: 3 };

  return members
    .map((member) => {
      const profile = byId.get(member.user_id);
      return {
        userId: member.user_id,
        displayName: profile?.full_name ?? "Someone",
        avatarUrl: profile?.avatar_url ?? null,
        role: member.role,
        plan: plans.get(member.user_id) ?? ("free" as SubscriptionPlan),
        isMe: member.user_id === viewerId
      };
    })
    .sort((a, b) => rank[a.role] - rank[b.role] || a.displayName.localeCompare(b.displayName));
}

export type RoomNoticeView = {
  id: string;
  body: string;
  title: string;
  priority: "normal" | "high";
  authorName: string;
  publishedAt: string;
  reactions: Array<{ type: string; count: number }>;
  myReaction: string | null;
};

/**
 * Room Notices -- room-scoped, NOT Event Updates.
 *
 * Event Updates reach everyone at the Event and are written by the host or an
 * Event admin. A Notice reaches one Room and is written by that Room's host or
 * co-host. Keeping them separate is the point; a Room's after-party plan is not
 * an official Event communication.
 */
export async function listRoomNotices(
  admin: Admin,
  viewerId: string,
  roomId: string
): Promise<RoomNoticeView[]> {
  const access = await resolveEventCircleAccess(admin, viewerId, roomId);
  if (!access.exists || !access.isMember) return [];

  const { data: notices } = await admin
    .from("event_announcements")
    .select("id, title, body, priority, author_id, published_at")
    .eq("event_circle_id", roomId)
    .order("published_at", { ascending: false })
    .limit(50);
  if (!notices || notices.length === 0) return [];

  const noticeIds = notices.map((notice) => notice.id);
  const authorIds = Array.from(new Set(notices.map((notice) => notice.author_id)));

  const [{ data: reactions }, { data: profiles }] = await Promise.all([
    admin
      .from("event_announcement_reactions")
      .select("event_announcement_id, user_id, reaction_type")
      .in("event_announcement_id", noticeIds),
    admin.from("profiles").select("user_id, full_name").in("user_id", authorIds)
  ]);

  const nameById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.full_name] as const));
  const counts = new Map<string, Map<string, number>>();
  const mine = new Map<string, string>();

  for (const reaction of reactions ?? []) {
    const perNotice = counts.get(reaction.event_announcement_id) ?? new Map<string, number>();
    perNotice.set(reaction.reaction_type, (perNotice.get(reaction.reaction_type) ?? 0) + 1);
    counts.set(reaction.event_announcement_id, perNotice);
    if (reaction.user_id === viewerId) mine.set(reaction.event_announcement_id, reaction.reaction_type);
  }

  return notices.map((notice) => ({
    id: notice.id,
    title: notice.title,
    body: notice.body,
    priority: notice.priority,
    authorName: nameById.get(notice.author_id) ?? "Host",
    publishedAt: notice.published_at,
    reactions: Array.from(counts.get(notice.id)?.entries() ?? []).map(([type, count]) => ({ type, count })),
    myReaction: mine.get(notice.id) ?? null
  }));
}

/**
 * Event-level authority: the host OR an Event admin.
 *
 * events.host_id is sole ownership and the host is deliberately absent from
 * event_admins, so any "can this person speak for the Event" question has to
 * ask both. Asking only event_admins silently excludes the host from their own
 * Event, which is the bug this helper exists to make impossible to write.
 */
export async function isEventOperator(admin: Admin, eventId: string, userId: string): Promise<boolean> {
  const { data: event } = await admin.from("events").select("host_id").eq("id", eventId).maybeSingle();
  if (event?.host_id === userId) return true;
  return viewerIsEventAdmin(admin, eventId, userId);
}

/**
 * May this viewer administer this Room?
 *
 * Room authority and Event authority are separate systems that meet here and
 * nowhere else. An Event admin may manage the Rooms of their Event because they
 * operate the Event; that does NOT make them a Room moderator elsewhere, and a
 * Room moderator gains no Event authority whatsoever.
 */
export async function canManageRoom(
  admin: Admin,
  userId: string,
  roomId: string
): Promise<{ allowed: boolean; eventId: string | null; role: EventCircleRole | null }> {
  const { data: room } = await admin
    .from("event_circles")
    .select("id, event_id, owner_id")
    .eq("id", roomId)
    .maybeSingle();
  if (!room) return { allowed: false, eventId: null, role: null };

  if (room.owner_id === userId) return { allowed: true, eventId: room.event_id, role: "host" };

  const { data: member } = await admin
    .from("event_circle_members")
    .select("role, status")
    .eq("event_circle_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = member?.status === "joined" ? member.role : null;
  if (role && canManageMembers(role)) return { allowed: true, eventId: room.event_id, role };

  // The Event's host and admins may operate the Rooms of their own Event, even
  // ones they did not create. viewerIsEventAdmin covers event_admins only --
  // the host is events.host_id and is deliberately not stored there (one owner,
  // one source of truth), so the host is checked separately rather than
  // assumed.
  if (room.event_id && (await isEventOperator(admin, room.event_id, userId))) {
    return { allowed: true, eventId: room.event_id, role };
  }
  return { allowed: false, eventId: room.event_id, role };
}

/**
 * Facts the join action needs, gathered once.
 *
 * Kept beside the list projection on purpose: the two must feed
 * resolveJoinEventCircle identically, or the button and the mutation drift.
 */
export async function gatherJoinFacts(
  admin: Admin,
  userId: string,
  roomId: string
): Promise<{
  room: {
    id: string;
    event_id: string | null;
    name: string;
    status: RoomStatus;
    join_mode: RoomJoinMode;
    opens_at: string | null;
    max_members: number;
  } | null;
  memberStatus: "joined" | "left" | "removed" | "banned" | null;
  memberCount: number;
  hasEventCheckIn: boolean;
  hasInvitation: boolean;
  hasGroupTargets: boolean;
  isEligibleGroupMember: boolean;
}> {
  const { data: room } = await admin
    .from("event_circles")
    .select("id, event_id, name, status, join_mode, opens_at, max_members")
    .eq("id", roomId)
    .maybeSingle();

  if (!room) {
    return {
      room: null,
      memberStatus: null,
      memberCount: 0,
      hasEventCheckIn: false,
      hasInvitation: false,
      hasGroupTargets: false,
      isEligibleGroupMember: false
    };
  }

  const [{ data: member }, memberCount, invited, groups] = await Promise.all([
    admin
      .from("event_circle_members")
      .select("status")
      .eq("event_circle_id", roomId)
      .eq("user_id", userId)
      .maybeSingle(),
    eventCircleMemberCount(admin, roomId),
    invitedRoomIds(admin, userId, [roomId]),
    groupEligibility(admin, userId, [roomId])
  ]);

  const hasEventCheckIn = room.event_id
    ? Boolean(await liveCheckIn(admin, userId, "event", room.event_id))
    : false;

  return {
    room,
    memberStatus: member?.status ?? null,
    memberCount,
    hasEventCheckIn,
    hasInvitation: invited.has(roomId),
    hasGroupTargets: groups.hasTargets.has(roomId),
    isEligibleGroupMember: groups.eligible.has(roomId)
  };
}

export { eventCircleMaxMembersFor, isEventCircleWritable };
