import { resolveRoleChange } from "@/lib/messaging/rules";
import type { ConversationRole } from "@/lib/supabase/database.types";
import type { GroupMemberView } from "@/lib/groups/types";

/**
 * How a member list is ordered and which actions each row offers.
 *
 * Pure, and separate from the component, because both of these are rules
 * rather than layout: "premium never affects ordering" and "never render an
 * action the server will always reject" are testable claims, and a component
 * test would not catch either one drifting.
 *
 * The action rules here MIRROR the server's `resolveRoleChange` rather than
 * re-deriving it — the menu asks the same function the action will ask, so the
 * UI cannot offer something the server refuses, and cannot hide something it
 * would allow. The server remains authoritative; this only decides what to
 * draw.
 */

/** Owner first, then Admins, then Members. */
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, moderator: 2, member: 3 };

/**
 * Sort members for display.
 *
 * Deliberately NOT influenced by membership tier. Ranking Pro members above
 * Free ones would turn a group roster into a leaderboard and quietly sell
 * position — the ordering is authority, then name, and nothing else.
 *
 * Within a role the tie-break is display name, which is deterministic and
 * stable across renders. The incoming array is already ordered by `joined_at`
 * from the query; `localeCompare` on a stable input keeps that deterministic.
 */
export function orderGroupMembers(members: readonly GroupMemberView[]): GroupMemberView[] {
  return [...members].sort((a, b) => {
    const rank = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
    if (rank !== 0) return rank;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * The label shown beside a name.
 *
 * Owner and Admin only. "Member" is deliberately absent: labelling the
 * ordinary case on every row is noise, and a badge that appears on everyone
 * communicates nothing.
 */
export function roleLabel(role: ConversationRole): string | null {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return null;
}

export type MemberAction =
  | "view_profile"
  | "promote_to_admin"
  | "demote_to_member"
  | "remove_member"
  | "transfer_ownership"
  | "leave_group";

export type MemberActionContext = {
  viewerRole: ConversationRole | null;
  viewerId: string;
  member: Pick<GroupMemberView, "userId" | "role" | "status">;
  /** Whether the member has a username to route a profile link to. */
  hasProfileRoute: boolean;
};

/**
 * The actions to offer for one member row.
 *
 * Ordered least-destructive first, so the dangerous entries are never the ones
 * under a mis-tap. Every management entry is gated by the SAME resolver the
 * server action runs, so this list can never contain an action that would be
 * rejected on submit.
 */
export function memberActions(context: MemberActionContext): MemberAction[] {
  const { viewerRole, viewerId, member, hasProfileRoute } = context;
  const actions: MemberAction[] = [];
  const selfTargeted = member.userId === viewerId;

  // Viewing your own row: profile is someone else's surface, so it is offered
  // only for other people.
  if (!selfTargeted && hasProfileRoute) actions.push("view_profile");

  if (!viewerRole) return actions;

  const shared = {
    actorRole: viewerRole,
    actorStatus: "joined" as const,
    targetRole: member.role,
    targetStatus: member.status,
    selfTargeted
  };

  if (selfTargeted) {
    // Your own row carries the two things you can do to yourself.
    if (viewerRole === "owner") {
      // The owner's only exit. Offered here rather than as a bare "Leave"
      // button that is guaranteed to fail.
      actions.push("transfer_ownership");
    } else {
      actions.push("leave_group");
    }
    return actions;
  }

  if (resolveRoleChange("promote_to_admin", shared).allowed && member.role === "member") {
    actions.push("promote_to_admin");
  }
  if (resolveRoleChange("demote_to_member", shared).allowed && member.role === "admin") {
    actions.push("demote_to_member");
  }
  if (resolveRoleChange("remove_member", shared).allowed) {
    actions.push("remove_member");
  }

  return actions;
}

/** Members eligible to receive ownership: joined, and not the current owner. */
export function ownershipCandidates(
  members: readonly GroupMemberView[],
  ownerId: string
): GroupMemberView[] {
  return orderGroupMembers(
    members.filter((member) => member.status === "joined" && member.userId !== ownerId)
  );
}

/** Human label for an action, used by both the menu and its confirmation. */
export const MEMBER_ACTION_LABELS: Record<MemberAction, string> = {
  view_profile: "View profile",
  promote_to_admin: "Make admin",
  demote_to_member: "Remove admin",
  remove_member: "Remove from Circle",
  transfer_ownership: "Transfer ownership",
  // The KEY stays `leave_group`: it is a stable internal identifier matching
  // the server action and the database. Only what the person reads changes.
  leave_group: "Leave Circle"
};

/** Actions that need a confirmation step before they run. */
export function needsConfirmation(action: MemberAction): boolean {
  return action === "remove_member" || action === "transfer_ownership" || action === "leave_group";
}
