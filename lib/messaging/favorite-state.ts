export const CHAT_FAVORITE_CHANGED_EVENT = "mad-buddy:chat-favorite-changed";

export function isChatFavorite(pinned: boolean, favoriteRank: number | null | undefined): boolean {
  return pinned || favoriteRank !== null && favoriteRank !== undefined;
}

export function announceChatFavorite(conversationId: string, favorite: boolean): void {
  window.dispatchEvent(new CustomEvent(CHAT_FAVORITE_CHANGED_EVENT, {
    detail: { conversationId, favorite }
  }));
}
