"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Bell,
  Loader2,
  MoreHorizontal,
  PenSquare,
  Plus,
  Search,
  Star,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  getMessageableFriendsAction,
  openDirectConversationAction,
  setConversationPinnedAction
} from "@/app/(app)/messaging-actions";
import { updateConversationUserPreferencesAction } from "@/app/(app)/messaging-ultimate-actions";
import { MessagesPageV4 } from "@/components/messages/messages-page-v4";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useUnreadNotificationCount } from "@/hooks/use-unread-notification-count";
import type { ConversationView, MessageableFriend } from "@/lib/messaging/mobile";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { cn } from "@/lib/utils";

/**
 * The 2026 Messages presentation shell.
 *
 * Chats V4 remains the authority for threads, drafts, presence, replies,
 * reactions, polls, rich media and delivery. This shell adds the stronger
 * inbox hierarchy the product review asked for without creating a second
 * messaging system: notification/profile access, the favorites people strip,
 * and a clearer New Chat entry all sit around the existing V4 surface.
 */
export function MessagesExperienceV5({
  initialConversations = [],
  voiceRecorderConfig = { enabled: false, maxDurationSeconds: 0 },
  viewerId = null,
  viewerDisplayName = "You",
  viewerAvatarUrl = null
}: {
  initialConversations?: ConversationView[];
  voiceRecorderConfig?: VoiceRecorderConfig;
  viewerId?: string | null;
  viewerDisplayName?: string;
  viewerAvatarUrl?: string | null;
}) {
  const router = useRouter();
  const { unreadCount, refresh: refreshNotifications } = useUnreadNotificationCount();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(initialConversations.filter((conversation) => conversation.pinned).map((conversation) => conversation.id))
  );
  const [favoriteManagerOpen, setFavoriteManagerOpen] = useState(false);
  const [favoriteListOpen, setFavoriteListOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setFavoriteIds(new Set(initialConversations.filter((conversation) => conversation.pinned).map((conversation) => conversation.id)));
  }, [initialConversations]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const favoriteConversations = useMemo(
    () => initialConversations
      .filter((conversation) => favoriteIds.has(conversation.id))
      .sort((a, b) => Date.parse(b.lastMessageAt ?? "") - Date.parse(a.lastMessageAt ?? "")),
    [favoriteIds, initialConversations]
  );

  function openConversation(conversationId: string) {
    router.push(`/messages?conversation=${conversationId}` as Route);
  }

  function toggleFavorite(conversation: ConversationView) {
    const next = !favoriteIds.has(conversation.id);
    setFavoriteIds((current) => {
      const copy = new Set(current);
      if (next) copy.add(conversation.id);
      else copy.delete(conversation.id);
      return copy;
    });
    setFeedback("");

    startTransition(async () => {
      const [legacy, preference] = await Promise.all([
        setConversationPinnedAction(conversation.id, next).catch(() => ({ ok: false, message: "Favorite could not be updated." })),
        updateConversationUserPreferencesAction({
          conversationId: conversation.id,
          favoriteRank: next ? 0 : null
        }).catch(() => ({ ok: false, message: "Favorite could not be updated." }))
      ]);

      if (!legacy.ok || !preference.ok) {
        setFavoriteIds((current) => {
          const copy = new Set(current);
          if (next) copy.delete(conversation.id);
          else copy.add(conversation.id);
          return copy;
        });
        setFeedback(!legacy.ok ? legacy.message : preference.message);
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="messages-experience-v5 flex h-full min-h-0 flex-col">
      {/*
        V4 already owns Search + filters. On phones we replace only its first
        title/compose row with the richer identity header below; desktop keeps
        the proven two-pane V4 chrome. The selector is anchored to semantics
        (the first row of the sticky inbox header), not generated class names.
      */}
      <style>{`
        @media (max-width: 1023px) {
          .messages-experience-v5 [data-v4-host] aside > div:first-child > div:first-child {
            display: none;
          }
          .messages-experience-v5 [data-v4-host] aside > div:first-child {
            padding-top: .3rem;
          }
        }
        .messages-experience-v5 .composer-row {
          gap: .55rem;
          padding: .55rem .7rem .5rem;
        }
        .messages-experience-v5 .composer-bubble {
          min-height: 48px;
          border: 1px solid hsl(var(--border) / .62);
          border-radius: 9999px;
          background: hsl(var(--secondary) / .58);
          box-shadow: 0 4px 18px hsl(var(--shadow) / .06);
        }
        .messages-experience-v5 .composer-bubble:focus-within {
          border-color: hsl(var(--primary) / .34);
          background: hsl(var(--background) / .96);
          box-shadow: 0 0 0 3px hsl(var(--primary) / .07), 0 6px 20px hsl(var(--shadow) / .08);
        }
        .messages-experience-v5 .composer-action {
          width: 48px;
          height: 48px;
          border-radius: 9999px;
          background: #E88C2B;
          color: #FEFBF3;
          box-shadow: 0 8px 22px rgba(78, 4, 1, .14);
        }
        .messages-experience-v5 .composer-action:hover {
          background: #D97F20;
        }
      `}</style>

      <section
        aria-label="Messages shortcuts"
        className="shrink-0 border-b border-black/[0.045] bg-background px-3 pb-2.5 pt-[max(.6rem,env(safe-area-inset-top))] dark:border-white/[0.06] lg:hidden"
      >
        <div className="flex min-h-11 items-center gap-2">
          <h1 className="min-w-0 flex-1 text-[1.55rem] font-semibold tracking-tight">Messages</h1>

          <Link
            href="/notifications"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            title="Notifications"
            className="focus-ring relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/55 bg-card/75 text-foreground shadow-sm transition-transform active:scale-95"
          >
            <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-background bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>

          <Link
            href="/profile"
            aria-label="Open my profile"
            title="My profile"
            className="focus-ring rounded-full transition-transform active:scale-95"
          >
            <UserAvatar
              name={viewerDisplayName || "You"}
              src={viewerAvatarUrl}
              size="sm"
              decorative
              className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_6px_18px_hsl(var(--shadow)/0.14)]"
            />
          </Link>

          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_22px_rgba(78,4,1,.14)] transition-transform active:scale-90"
            aria-label="New chat"
            title="New chat"
          >
            <PenSquare className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2.5 flex items-end gap-2.5 overflow-x-auto pb-1 no-scrollbar" aria-label="Favorite chats">
          <FavoriteShortcut
            label="Add"
            onClick={() => setFavoriteManagerOpen(true)}
            icon={<Plus className="h-5 w-5" aria-hidden="true" />}
          />

          {favoriteConversations.slice(0, 5).map((conversation) => (
            <FavoritePerson
              key={conversation.id}
              conversation={conversation}
              onClick={() => openConversation(conversation.id)}
            />
          ))}

          <FavoriteShortcut
            label="More"
            onClick={() => setFavoriteListOpen(true)}
            icon={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
            badge={favoriteConversations.length > 5 ? favoriteConversations.length : undefined}
          />
        </div>
      </section>

      {feedback ? (
        <p className="shrink-0 px-4 py-1.5 text-xs font-medium text-destructive lg:hidden" role="status">
          {feedback}
        </p>
      ) : null}

      <div data-v4-host className="min-h-0 flex-1">
        <MessagesPageV4
          initialConversations={initialConversations}
          voiceRecorderConfig={voiceRecorderConfig}
          viewerId={viewerId}
        />
      </div>

      <ManageFavoritesModal
        open={favoriteManagerOpen}
        onOpenChange={setFavoriteManagerOpen}
        conversations={initialConversations}
        favoriteIds={favoriteIds}
        pending={isPending}
        onToggle={toggleFavorite}
      />

      <FavoriteListModal
        open={favoriteListOpen}
        onOpenChange={setFavoriteListOpen}
        conversations={favoriteConversations}
        onOpenConversation={(id) => {
          setFavoriteListOpen(false);
          openConversation(id);
        }}
        onManage={() => {
          setFavoriteListOpen(false);
          setFavoriteManagerOpen(true);
        }}
      />

      <NewChatModal
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        pending={isPending}
        onSelect={(friendId) => {
          startTransition(async () => {
            const result = await openDirectConversationAction(friendId).catch(() => ({
              ok: false,
              message: "Could not open that chat.",
              conversationId: undefined
            }));
            if (!result.ok || !result.conversationId) {
              setFeedback(result.message);
              return;
            }
            setNewChatOpen(false);
            router.push(`/messages?conversation=${result.conversationId}` as Route);
          });
        }}
        onGroups={() => {
          setNewChatOpen(false);
          router.push("/groups" as Route);
        }}
      />
    </div>
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
  icon: React.ReactNode;
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
        {badge ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[8px] font-bold text-primary-foreground">
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
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
  pending,
  onToggle
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: ConversationView[];
  favoriteIds: ReadonlySet<string>;
  pending: boolean;
  onToggle: (conversation: ConversationView) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = conversations.filter((conversation) => conversation.kind === "direct");
    return term ? rows.filter((conversation) => conversation.title.toLowerCase().includes(term)) : rows;
  }, [conversations, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Favorites" variant="sheet">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Keep the people you message most one tap away.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a Muddy" className="h-11 rounded-2xl pl-10" />
        </div>
        <ul className="max-h-[56vh] space-y-1 overflow-y-auto">
          {visible.map((conversation) => {
            const favorite = favoriteIds.has(conversation.id);
            return (
              <li key={conversation.id}>
                <button
                  type="button"
                  disabled={pending}
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
                  className="focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left hover:bg-secondary/65"
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

function NewChatModal({
  open,
  onOpenChange,
  pending,
  onSelect,
  onGroups
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSelect: (friendId: string) => void;
  onGroups: () => void;
}) {
  const [friends, setFriends] = useState<MessageableFriend[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || friends !== null) return;
    void getMessageableFriendsAction().then(setFriends);
  }, [friends, open]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!friends) return [];
    return term
      ? friends.filter((friend) => `${friend.displayName} ${friend.username}`.toLowerCase().includes(term))
      : friends;
  }, [friends, query]);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New chat" variant="sheet">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Muddies or usernames" autoFocus className="h-11 rounded-2xl pl-10" />
        </div>
        <button
          type="button"
          onClick={onGroups}
          className="focus-ring flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-primary/[.07] p-3 text-left"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#4E0401] text-[#FEFBF3]"><UsersRound className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">Groups</strong><span className="text-xs text-muted-foreground">Open or create a group</span></span>
        </button>
        {friends === null ? (
          <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No Muddies match your search.</p>
        ) : (
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto">
            {visible.map((friend) => (
              <li key={friend.friendId}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onSelect(friend.friendId)}
                  className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-secondary/70 disabled:opacity-60"
                >
                  <UserAvatar name={friend.displayName} src={friend.avatarUrl} size="sm" decorative />
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{friend.displayName}</strong><span className="block truncate text-xs text-muted-foreground">@{friend.username}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
