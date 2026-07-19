import type { ConversationRole, GroupJoinMode, GroupPostingMode } from "@/lib/supabase/database.types";

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  role: ConversationRole | null;
  joinMode: GroupJoinMode;
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

export type GroupMemberView = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: ConversationRole;
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
  members: GroupMemberView[];
  inviteCandidates: GroupInviteCandidate[];
};
