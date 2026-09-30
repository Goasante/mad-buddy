export const STORY_ACTIVE_LIMIT = 5;
export const STORY_LIFETIME_HOURS = 12;
export const STORY_LIFETIME_MS = STORY_LIFETIME_HOURS * 60 * 60 * 1000;
export const STORY_CAPTION_MAX_LENGTH = 200;

export type StoryAudienceType = "all_muddies" | "close_friends" | "selected_muddies";

export type StorySummary = {
  authorId: string;
  activeCount: number;
  unseenCount: number;
  hasUnseen: boolean;
  nextExpiryAt: string | null;
  latestStoryAt: string | null;
};

export type StoryItem = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  mediaId: string;
  mediaUrl: string;
  caption: string | null;
  audienceType: StoryAudienceType;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  liked: boolean;
  isAuthor: boolean;
};

export type StoryAudienceOption = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type StoryCreationContext = {
  muddies: StoryAudienceOption[];
  closeFriendsAvailable: boolean;
};

export function storySlotsRemaining(activeCount: number): number {
  return Math.max(0, STORY_ACTIVE_LIMIT - Math.max(0, activeCount));
}

export type StoryViewerRecord = {
  id: string;
  name: string;
  avatarUrl: string | null;
  viewedAt: string;
  liked: boolean;
};

/** Only returned to the creator of the active Story. */
export type StoryEngagement = {
  viewCount: number;
  likeCount: number;
  viewers: StoryViewerRecord[];
  nextOffset: number | null;
};
