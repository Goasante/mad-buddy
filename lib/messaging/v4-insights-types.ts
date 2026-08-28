export type MessageReadPerson = {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  readAt: string | null;
};

export type MessageInfoView = {
  messageId: string;
  createdAt: string;
  editedAt: string | null;
  state: "sent" | "delivered" | "read" | "deleted" | "removed_by_moderation" | "failed";
  readBy: MessageReadPerson[];
  unreadReceiptCount: number;
};

export type SavedMessageFolderView = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
};

export type ChatCollectionMessageView = {
  messageId: string;
  senderName: string;
  preview: string;
  messageType: string;
  createdAt: string;
  savedAt: string | null;
  folderId: string | null;
  pinnedAt: string | null;
};

export type ChatCollectionsView = {
  folders: SavedMessageFolderView[];
  saved: ChatCollectionMessageView[];
  pinned: ChatCollectionMessageView[];
};
