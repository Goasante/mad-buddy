export type ChatCapabilityRule = "all_members" | "admins" | "owner" | "disabled";

export type ChatMediaMode = "keep" | "view_once" | "24h";
export type ChatViewerRole = "owner" | "admin" | "moderator" | "member" | null;

export type ConversationChatSettingsView = {
  messageLifetimeSeconds: number | null;
  defaultMediaMode: ChatMediaMode;
  whoCanPin: ChatCapabilityRule;
  whoCanCreatePolls: ChatCapabilityRule;
  whoCanUseEveryone: ChatCapabilityRule;
  whoCanAddMembers: ChatCapabilityRule;
  whoCanEditInfo: "admins" | "owner";
};

export type ConversationUserPreferencesView = {
  archivedAt: string | null;
  markedUnreadAt: string | null;
  favoriteRank: number | null;
  themeKey: string;
  notificationPreview: "always" | "when_unlocked" | "never";
  notifyMentionsWhenMuted: boolean;
  notifyRepliesWhenMuted: boolean;
  draftText: string | null;
  draftUpdatedAt: string | null;
  readingAnchorMessageId: string | null;
  readingAnchorOffset: number;
  voicePlaybackMessageId: string | null;
  voicePlaybackSeconds: number;
};

export type ConversationPresencePerson = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isTyping: boolean;
  isInChat: boolean;
  lastActiveAt: string;
};

export type ConversationPinView = {
  id: string;
  messageId: string;
  pinnedAt: string;
  pinnedBy: string | null;
};

export type ChatPollOptionView = {
  id: string;
  label: string;
  position: number;
  voteCount: number;
  votedByMe: boolean;
};

export type ChatPollView = {
  messageId: string;
  question: string;
  allowMultiple: boolean;
  isAnonymous: boolean;
  closedAt: string | null;
  totalVoters: number;
  options: ChatPollOptionView[];
};

export type UltimateConversationState = {
  viewerRole: ChatViewerRole;
  settings: ConversationChatSettingsView;
  preferences: ConversationUserPreferencesView;
  presence: ConversationPresencePerson[];
  pins: ConversationPinView[];
  savedMessageIds: string[];
  polls: ChatPollView[];
};

export const DEFAULT_CHAT_SETTINGS: ConversationChatSettingsView = {
  messageLifetimeSeconds: null,
  defaultMediaMode: "keep",
  whoCanPin: "all_members",
  whoCanCreatePolls: "all_members",
  whoCanUseEveryone: "admins",
  whoCanAddMembers: "admins",
  whoCanEditInfo: "admins"
};

export const DEFAULT_CONVERSATION_USER_PREFERENCES: ConversationUserPreferencesView = {
  archivedAt: null,
  markedUnreadAt: null,
  favoriteRank: null,
  themeKey: "default",
  notificationPreview: "when_unlocked",
  notifyMentionsWhenMuted: true,
  notifyRepliesWhenMuted: true,
  draftText: null,
  draftUpdatedAt: null,
  readingAnchorMessageId: null,
  readingAnchorOffset: 0,
  voicePlaybackMessageId: null,
  voicePlaybackSeconds: 0
};
