import type {
  ConversationMemberStatus,
  ConversationRole,
  GroupJoinMode,
  GroupVisibility,
  GroupPostingMode,
  SubscriptionPlan
} from "@/lib/supabase/database.types";

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  /**
   * Signed thumbnail, or null. Doubles as the group's avatar and as its card
   * art on Linkr, so one upload serves both rather than two systems.
   */
  imageUrl: string | null;
  memberCount: number;
  role: ConversationRole | null;
  joinMode: GroupJoinMode;
  /** Who can see the group exists. Never implies who can join it. */
  visibility: GroupVisibility;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

export type GroupInvitation = GroupSummary & {
  invitedByName: string;
};

export type GroupsPageData = {
  groups: GroupSummary[];
  discoverableGroups: GroupSummary[];
  invitations: GroupInvitation[];
};

/**
 * One group member, as a co-member is authorised to see them.
 *
 * Deliberately narrow: display name, username, avatar, membership tier, group
 * role and membership state — the fields the member list and the message
 * identity layer need, and nothing else. No email, phone, location or hidden
 * profile fields are ever projected here.
 */
export type GroupMemberView = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: ConversationRole;
  /** Effective membership tier, for the canonical premium ring/badge. */
  plan: SubscriptionPlan | null;
  /** Current membership state, so Stage 3C can render it without re-querying. */
  status: ConversationMemberStatus;
};

export type GroupInviteCandidate = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
};

export type GroupDetailView = GroupSummary & {
  postingMode: GroupPostingMode;
  canManageMembers: boolean;
  /** The signed-in viewer, so role-aware rows can identify their own row. */
  viewerId: string;
  members: GroupMemberView[];
  inviteCandidates: GroupInviteCandidate[];
};
