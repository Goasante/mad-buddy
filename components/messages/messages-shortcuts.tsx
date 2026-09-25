"use client";

import Link from "next/link";
import { Bell, Loader2, MoreHorizontal, Plus, Search, Star, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getMessageableFriendsAction } from "@/app/(app)/messaging-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { CountBadge } from "@/components/ui/count-badge";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import type { ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import { cn } from "@/lib/utils";

/** Inbox shortcuts are presentational. MessagesPage owns the conversation list and favorite writes. */
export function MessagesShortcuts({
  conversations, viewerDisplayName, viewerAvatarUrl, onOpenConversation, onToggleFavorite
}: {
  conversations: ConversationView[];
  viewerDisplayName: string;
  viewerAvatarUrl: string | null;
  onOpenConversation: (id: string) => void;
  onToggleFavorite: (conversation: ConversationView) => void;
}) {
  const { unreadCount, refresh: refreshNotifications } = useUnreadNotificationCount();
  const [favoriteManagerOpen, setFavoriteManagerOpen] = useState(false);
  const [favoriteListOpen, setFavoriteListOpen] = useState(false);
  const favorites = useMemo(() => conversations.filter((row) => row.pinned), [conversations]);
  const favoriteIds = useMemo(() => new Set(favorites.map((row) => row.id)), [favorites]);

  useEffect(() => { void refreshNotifications(); }, [refreshNotifications]);

  return <>
    <section aria-label="Messages shortcuts" className="shrink-0 border-b border-black/[0.045] bg-background px-3 pb-2.5 pt-[max(.6rem,env(safe-area-inset-top))] dark:border-white/[0.06] lg:hidden">
      <div className="flex min-h-11 items-center gap-2">
        <h1 className="min-w-0 flex-1 text-[1.55rem] font-semibold tracking-tight">Messages</h1>
        <Link href="/notifications" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} title="Notifications" className="focus-ring relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/55 bg-card/75 text-foreground shadow-sm active:scale-95">
          <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          {unreadCount > 0 ? <CountBadge count={unreadCount} tone="primary" /> : null}
        </Link>
        <Link href="/profile" aria-label="Open my profile" title="My profile" className="focus-ring rounded-full active:scale-95">
          <UserAvatar name={viewerDisplayName || "You"} src={viewerAvatarUrl} size="sm" decorative className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_6px_18px_hsl(var(--shadow)/0.14)]" />
        </Link>
      </div>
      <div className="mt-2.5 flex items-end gap-2.5 overflow-x-auto pb-1 no-scrollbar" aria-label="Favorite chats">
        <FavoriteShortcut label="Add" onClick={() => setFavoriteManagerOpen(true)} icon={<Plus className="h-5 w-5" aria-hidden="true" />} />
        {favorites.slice(0, 5).map((conversation) => <FavoritePerson key={conversation.id} conversation={conversation} onClick={() => onOpenConversation(conversation.id)} />)}
        <FavoriteShortcut label="More" onClick={() => setFavoriteListOpen(true)} icon={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />} badge={favorites.length > 5 ? favorites.length : undefined} />
      </div>
    </section>
    <ManageFavoritesModal open={favoriteManagerOpen} onOpenChange={setFavoriteManagerOpen} conversations={conversations} favoriteIds={favoriteIds} onToggle={onToggleFavorite} />
    <FavoriteListModal open={favoriteListOpen} onOpenChange={setFavoriteListOpen} conversations={favorites} onOpenConversation={(id) => { setFavoriteListOpen(false); onOpenConversation(id); }} onManage={() => { setFavoriteListOpen(false); setFavoriteManagerOpen(true); }} />
  </>;
}

export function MessagesStyles() {
  return (
    <style>{`
      @media (max-width: 1023px) {
        /* The mobile title lives above the inbox; desktop keeps its inbox title. */
        .messages-page [data-chat-inbox] aside > div:first-child > div:first-child {
          display: none;
        }

        /* Keep New Chat beside the canonical search field. */
        .messages-page [data-chat-inbox] aside > div:first-child {
          padding-top: .3rem;
        }
        .messages-page [data-chat-inbox] aside > div:first-child > div:nth-child(2) {
          margin-right: 3.25rem;
        }
        .messages-page [data-new-chat-trigger] {
          right: .75rem;
          top: 1.05rem;
        }
      }

      .messages-page .composer-row {
        gap: .55rem;
        padding: .55rem .7rem .5rem;
      }
      .messages-page .composer-bubble {
        min-height: 48px;
        border: 1px solid hsl(var(--border) / .62);
        border-radius: 9999px;
        background: hsl(var(--secondary) / .58);
        box-shadow: 0 4px 18px hsl(var(--shadow) / .06);
      }
      .messages-page .composer-bubble:focus-within {
        border-color: hsl(var(--primary) / .34);
        background: hsl(var(--background) / .96);
        box-shadow: 0 0 0 3px hsl(var(--primary) / .07), 0 6px 20px hsl(var(--shadow) / .08);
      }
      .messages-page .composer-action {
        width: 48px;
        height: 48px;
        border-radius: 9999px;
        background: #E88C2B;
        color: #FEFBF3;
        box-shadow: 0 8px 22px rgba(78, 4, 1, .14);
      }
      .messages-page .composer-action:hover {
        background: #D97F20;
      }

      /*
        The software keyboard shortens the visual viewport. The shared Modal
        retains its safe-area sheet defaults; this one sheet gets an additional
        dynamic-viewport cap so focusing Search cannot push its title/close
        affordance under the notch. The second declaration wins on browsers
        with dvh support; svh remains the fallback.
      */
      @media (max-width: 639px) {
        [data-modal-owner="messages-new-chat"] {
          max-height: calc(100svh - env(safe-area-inset-top, 0px) - .5rem);
          max-height: calc(100dvh - env(safe-area-inset-top, 0px) - .5rem);
        }
        [data-modal-owner="messages-new-chat"]:focus-within [data-new-chat-results] {
          max-height: min(9.5rem, 30dvh);
        }
      }
    `}</style>
  );
}

function FavoritePerson({ conversation, onClick }: { conversation: ConversationView; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-[58px] shrink-0 flex-col items-center gap-1 rounded-xl text-center"
      aria-label={`Open favorite chat ${conversation.title}`}
    >
      <ConversationShortcutAvatar conversation={conversation} />
      <span className="w-full truncate text-[11px] font-medium text-foreground/80">{conversation.title}</span>
    </button>
  );
}

function ConversationShortcutAvatar({ conversation }: { conversation: ConversationView }) {
  if (conversation.kind === "direct") {
    return (
      <UserAvatar
        name={conversation.title}
        src={conversation.avatarUrl}
        size="sm"
        decorative
        className="border-2 border-background ring-1 ring-primary/20 shadow-[0_5px_16px_hsl(var(--shadow)/0.13)]"
      />
    );
  }

  return (
    <span className="relative grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3] shadow-[0_5px_16px_hsl(var(--shadow)/0.13)]">
      <UsersRound className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="absolute -bottom-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full border-2 border-background bg-primary px-0.5 text-[8px] font-bold text-primary-foreground">
        {conversation.kind === "plan" ? "P" : conversation.kind === "event" ? "E" : "G"}
      </span>
    </span>
  );
}

function FavoriteShortcut({
  label,
  onClick,
  icon,
  badge
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-[54px] shrink-0 flex-col items-center gap-1 rounded-xl text-center"
      aria-label={label === "Add" ? "Manage favorites" : "View all favorites"}
    >
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-secondary/75 text-muted-foreground ring-1 ring-border/45">
        {icon}
        {badge ? <CountBadge count={Math.min(badge, 99)} tone="primary" /> : null}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

function ManageFavoritesModal({
  open,
  onOpenChange,
  conversations,
  favoriteIds,
  onToggle
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationView[];
  favoriteIds: ReadonlySet<string>;
  onToggle: (conversation: ConversationView) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? conversations.filter((row) => row.title.toLowerCase().includes(term)) : conversations;
  }, [conversations, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Favorites" variant="sheet">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Keep important chats one tap away.</p>
        <SearchField value={query} onChange={setQuery} placeholder="Find a chat or group" />
        <ul className="max-h-[56vh] space-y-1 overflow-y-auto">
          {visible.map((conversation) => {
            const favorite = favoriteIds.has(conversation.id);
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onToggle(conversation)}
                  className="focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-secondary/65 disabled:opacity-60"
                >
                  <UserAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" decorative />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.title}</span>
                  <span className={cn("grid h-9 w-9 place-items-center rounded-full", favorite ? "bg-primary/12 text-primary" : "bg-secondary text-muted-foreground")}>
                    <Star className={cn("h-4 w-4", favorite && "fill-current")} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

function FavoriteListModal({
  open,
  onOpenChange,
  conversations,
  onOpenConversation,
  onManage
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationView[];
  onOpenConversation: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Favorite chats" variant="sheet">
      <div className="space-y-3">
        {conversations.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">
            No favorites yet. Add the people you talk to most.
          </div>
        ) : (
          <ul className="max-h-[56vh] space-y-1 overflow-y-auto">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(conversation.id)}
                  className="focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-secondary/65"
                >
                  <ConversationShortcutAvatar conversation={conversation} />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{conversation.title}</strong>
                    <span className="block truncate text-xs text-muted-foreground">{conversation.lastMessagePreview ?? "Open chat"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" className="w-full" onClick={onManage}>Manage favorites</Button>
      </div>
    </Modal>
  );
}

export function NewChatModal({
  open,
  onOpenChange,
  pending,
  pendingFriendId,
  onSelect,
  onGroups
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  pendingFriendId: string | null;
  onSelect: (friendId: string) => void;
  onGroups: () => void;
}) {
  const [friends, setFriends] = useState<MessageableFriend[] | null>(null);
  const [query, setQuery] = useState("");
  const [friendsLoadError, setFriendsLoadError] = useState(false);

  useEffect(() => {
    if (!open || friends !== null || friendsLoadError) return;
    void getMessageableFriendsAction().then(setFriends).catch(() => setFriendsLoadError(true));
  }, [friends, friendsLoadError, open]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return [];
    return term
      ? friends.filter((friend) => `${friend.displayName} ${friend.username}`.toLowerCase().includes(term))
      : friends;
  }, [friends, query]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="New chat"
      variant="sheet"
      owner="messages-new-chat"
    >
      <div className="space-y-3">
        {pending ? <p role="status" className="text-sm font-medium text-primary">Opening chat…</p> : null}
        {/* Do not summon the software keyboard just because the sheet opened.
            The member list is useful before search, and avoiding autoFocus also
            prevents the keyboard opening during the sheet's entrance geometry. */}
        <SearchField value={query} onChange={setQuery} placeholder="Search Muddies or usernames" />
        <button
          type="button"
          onClick={onGroups}
          className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-primary/[.07] p-3 text-left"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]">
            <UsersRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm">Groups</strong>
            <span className="text-xs text-muted-foreground">Create, manage or open a private Group</span>
          </span>
        </button>
        {friendsLoadError ? (
          <div className="space-y-2 py-6 text-center text-sm" role="alert">
            <p>Could not load Muddies.</p>
            <Button variant="outline" onClick={() => setFriendsLoadError(false)}>Try again</Button>
          </div>
        ) : friends === null ? (
          <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No Muddies match your search.</p>
        ) : (
          <ul data-new-chat-results className="max-h-[min(55svh,22rem)] space-y-1 overflow-y-auto overscroll-contain">
            {visible.map((friend) => (
              <li key={friend.friendId}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onSelect(friend.friendId)}
                  aria-busy={pendingFriendId === friend.friendId}
                  className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-secondary/70 active:bg-secondary disabled:opacity-60"
                >
                  <UserAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" decorative />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><strong className="truncate text-sm">{friend.displayName}</strong><VerifiedAccountMark isVerifiedAccount={friend.isVerifiedAccount} compact inControl /></span>
                    <span className="block truncate text-xs text-muted-foreground">@{friend.username}</span>
                  </span>
                  {pendingFriendId === friend.friendId ? <span className="shrink-0 text-xs font-medium text-primary">Opening…</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function SearchField({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-2xl pl-10"
      />
    </div>
  );
}
