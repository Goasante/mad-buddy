"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cameFromInsideApp as enteredFromInsideApp } from "@/lib/navigation/entry-origin";
import { ChevronLeft, LogOut, MoreHorizontal, UserPlus, Users2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getMessagesAction, markConversationReadAction } from "@/app/(app)/messaging-actions";
import { MESSAGES_UPDATED_EVENT } from "@/hooks/use-unread-message-count";
import type { CSSProperties } from "react";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import {
  demoteGroupAdminAction,
  inviteGroupMemberAction,
  leaveGroupAction,
  promoteGroupAdminAction,
  removeGroupMemberAction,
  setGroupVisibilityAction,
  transferGroupOwnershipAction
} from "@/app/(app)/group-actions";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { startsNewDay, startsNewRun } from "@/lib/messaging/conversation-presence";
import { useTransientFeedback } from "@/hooks/use-transient-feedback";
import type { GroupDetailView, GroupInviteCandidate, GroupMemberView } from "@/lib/groups/types";
import {
  MEMBER_ACTION_LABELS,
  MEMBER_NAME_PLACEHOLDER,
  memberActions,
  needsConfirmation,
  orderGroupMembers,
  ownershipCandidates,
  roleLabel,
  type MemberAction
} from "@/lib/groups/member-presentation";
import { AppMenu } from "@/components/ui/app-dropdown";
import { LongPressActions } from "@/components/ui/long-press-actions";
import { MessageAttachmentImage } from "@/components/messaging/message-attachment-image";
import { MessageComposer } from "@/components/messaging/message-composer";
import { MessageText } from "@/components/messaging/message-text";
import { VoiceMessageBubble } from "@/components/messaging/voice-message-bubble";
import type { VoiceRecorderConfig } from "@/lib/messaging/voice-recording";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { withTimeout } from "@/lib/network/resilience";
import { cn, formatRelativeTime } from "@/lib/utils";

type GroupTab = "chat" | "members" | "media";

export function GroupDetailPage({
  group,
  initialMessages,
  voiceRecorderConfig = { enabled: false, maxDurationSeconds: 0 }
}: {
  group: GroupDetailView;
  initialMessages: ChatMessageView[];
  voiceRecorderConfig?: VoiceRecorderConfig;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<GroupTab>("chat");
  const [messages, setMessages] = useState(initialMessages);
  // Which message's photo is open full-screen. The id (not the object) so a
  // realtime refresh cannot leave a stale copy of the message on screen.
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  /* Same rule as the direct inbox: "Sent", "Joined" and the like clear
     themselves, while a failure stays until something replaces it. */
  const [feedback, setFeedback] = useTransientFeedback();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [candidates, setCandidates] = useState(group.inviteCandidates);
  const [isPending, startTransition] = useTransition();
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<GroupMemberView | null>(null);
  // One confirmation slot for every high-consequence action, so two can never
  // be open at once and a stale one cannot fire against the wrong person.
  const [confirm, setConfirm] = useState<{ kind: MemberAction; member: GroupMemberView | null } | null>(null);

  // Newest first, matching how a gallery is read.
  const mediaMessages = useMemo(
    () => messages.filter((item) => item.attachment).reverse(),
    [messages]
  );
  const orderedMembers = useMemo(() => orderGroupMembers(group.members), [group.members]);
  /**
   * Who can be mentioned: this Group's current members.
   *
   * INCLUDING YOURSELF. "@me" reads naturally in a sentence -- "I'll bring it,
   * @Ama and I are driving" -- and excluding it would make the picker
   * disagree with the text people actually write. It notifies nobody: the
   * server drops the sender before storing a row, so a self-mention renders
   * and never buzzes.
   *
   * These members have already passed this page's own authorisation, and the
   * server re-validates every id on send regardless.
   *
   * THE NAME MUST BE THE ONE THE RENDERER CAN FIND, and that is the whole of
   * the Group mention bug. `MessageText` locates a mention by searching the
   * message for "@" + the displayName that `getMessages` projects, which is
   * `full_name || username`. This page's member list comes from a different
   * projection, `loadGroupDetail`, which falls back to the literal placeholder
   * **"A Muddy"** for a member whose full name it could not read. Picking that
   * member inserted "@A Muddy" into the text, the server stored the mention row
   * correctly and notified the right person -- and then the renderer looked for
   * "@" + their real name, found nothing, and the highlight vanished the moment
   * the message came back. The name was there while typing and gone after send:
   * exactly the reported symptom.
   *
   * So the placeholder is stripped here rather than passed on. A member the
   * renderer could not name is not offered at all, which is honest: better to
   * be unmentionable than to insert a name that silently fails to resolve.
   */
  const mentionCandidates = useMemo(
    () =>
      orderedMembers
        .map((member) => ({
          userId: member.userId,
          // Mirrors getMessages: full name, else username. Never a placeholder.
          displayName:
            member.displayName && member.displayName !== MEMBER_NAME_PLACEHOLDER
              ? member.displayName
              : member.username,
          username: member.username,
          avatarUrl: member.avatarUrl
        }))
        .filter((member) => Boolean(member.displayName)),
    [orderedMembers]
  );
  const ownershipOptions = useMemo(
    () => ownershipCandidates(group.members, group.viewerId),
    [group.members, group.viewerId]
  );

  /**
   * Route a chosen menu action.
   *
   * Destructive and high-consequence actions go through a confirmation first;
   * promote/demote apply immediately, because both are trivially reversible by
   * the same person who just performed them.
   *
   * NO optimistic mutation. The row's role is server state, and rolling back a
   * failed promotion would mean briefly showing someone as an admin who never
   * was — a refresh after confirmed success is honest and costs one request.
   */
  function runMemberAction(action: MemberAction, member: GroupMemberView) {
    if (action === "view_profile") {
      router.push(`/friends/${member.username}`);
      return;
    }
    if (action === "transfer_ownership") {
      setTransferOpen(true);
      return;
    }
    if (needsConfirmation(action)) {
      setConfirm({ kind: action, member });
      return;
    }
    applyRole(action, member);
  }

  function applyRole(action: MemberAction, member: GroupMemberView | null) {
    if (isPending) return;
    startTransition(async () => {
      const payload = member ? { groupId: group.id, userId: member.userId } : null;
      const result =
        action === "promote_to_admin" && payload
          ? await promoteGroupAdminAction(payload)
          : action === "demote_to_member" && payload
            ? await demoteGroupAdminAction(payload)
            : action === "remove_member" && payload
              ? await removeGroupMemberAction(payload)
              : action === "leave_group"
                ? await leaveGroupAction(group.id)
                : { ok: false, message: "That action isn't available." };

      setConfirm(null);
      setFeedback(result.message);
      if (!result.ok) return;
      if (action === "leave_group") {
        router.push("/groups");
        return;
      }
      // Re-read from the server rather than patching local state: the row's
      // role and the viewer's own permissions both change here.
      router.refresh();
    });
  }

  function confirmTransfer() {
    if (isPending || !transferTarget) return;
    startTransition(async () => {
      const result = await transferGroupOwnershipAction({ groupId: group.id, userId: transferTarget.userId });
      setFeedback(result.message);
      if (result.ok) {
        setTransferOpen(false);
        setTransferTarget(null);
        router.refresh();
      }
    });
  }
  const mountedRef = useRef(true);

  /**
   * Was this page reached from somewhere else in the app?
   *
   * Read ONCE on mount: history.length grows as the person moves around, so
   * checking it later would answer a different question than "how did I get
   * here". A fresh tab opened straight onto this URL has a length of 1 and no
   * in-app referrer, and that is the only case that needs a fallback
   * destination -- everything else has a real place to go back to.
   */
  /* The shared rule (lib/navigation/entry-origin.ts), which this screen
     originally established. Consolidating also drops the old
     `referrer.startsWith(origin)` check, which read
     "https://mad-buddy.com.evil.test" as our own host. Same behaviour for
     every real entry; still decided once, on mount. */
  const [cameFromInsideApp] = useState(() => enteredFromInsideApp());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * The chat panel takes exactly the room the phone actually leaves it.
   *
   * The old height was `h-[min(620px,65vh)]` -- a fixed card, not a viewport.
   * On an 844px phone 65vh is 549px, so the conversation ended part way up the
   * screen with a large dead region beneath it and the bottom navigation
   * floating further down still. `vh` is also the wrong unit here: iOS
   * measures it against the viewport WITHOUT browser chrome, so it over-reports
   * and content can ride up under the status area.
   *
   * Subtracting a guessed stack of header and tab heights does not work either
   * -- everything above this panel varies with content and with the top inset,
   * so any constant is wrong on some device. Measuring the panel's own top and
   * subtracting what genuinely sits below it (the navigation and the bottom
   * safe area) is the only version that holds on every screen.
   *
   * `visualViewport` is observed as well as `resize` so the panel follows the
   * keyboard opening and closing rather than being covered by it.
   */
  const chatPanelRef = useRef<HTMLElement>(null);
  const [chatHeight, setChatHeight] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "chat") return;
    const measure = () => {
      const node = chatPanelRef.current;
      if (!node) return;
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      if (isDesktop) {
        setChatHeight(null);
        return;
      }

      const visual = window.visualViewport;
      const visibleTop = visual?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (visual?.height ?? window.innerHeight);
      let top = node.getBoundingClientRect().top;

      /* A software keyboard shortens visualViewport without necessarily
       * changing innerHeight. Move the chat to the top of that visible window
       * before sizing it; otherwise the preserved Group header consumes the
       * entire short viewport and the composer remains below the keyboard. */
      const keyboardOpen = Boolean(visual && visual.height < window.innerHeight - 120);
      if (keyboardOpen && top > visibleTop + 8) {
        node.scrollIntoView({ block: "start", behavior: "auto" });
        top = node.getBoundingClientRect().top;
      }

      /* Measure the real rendered bar, including its safe-area padding. A CSS
       * variable expressed in rem only described its nominal content height;
       * it could not account for device insets or an app bar translated out
       * of view. */
      const mobileNav = document.querySelector<HTMLElement>('[aria-label="Mobile navigation"]');
      const navRect = mobileNav?.getBoundingClientRect();
      const navIsVisible = Boolean(
        mobileNav &&
        mobileNav.getAttribute("aria-hidden") !== "true" &&
        navRect &&
        navRect.height > 0 &&
        navRect.top < visibleBottom
      );
      const lowerBoundary = navIsVisible && navRect ? Math.min(visibleBottom, navRect.top) : visibleBottom;
      let available = lowerBoundary - top - 12;

      /* Chromium's mobile emulation (and some Android webviews) resize the
       * layout viewport together with the visual viewport, so the keyboard
       * ratio above cannot identify the keyboard. The geometry still can: if
       * even the composer's minimum cannot fit, scroll the chat header out of
       * the way and recompute against the same visible lower boundary. */
      if (available < 96 && top > visibleTop + 8) {
        node.scrollIntoView({ block: "start", behavior: "auto" });
        top = node.getBoundingClientRect().top;
        available = lowerBoundary - top - 12;
      }

      // 96px always keeps the one-row composer usable. Unlike the former
      // 320px min-height, it cannot push the composer below a short phone.
      setChatHeight(Number.isFinite(available) ? Math.max(96, Math.round(available)) : 240);
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [tab, messages.length]);

  const chatPanelStyle = useMemo(
    () => (chatHeight ? ({ "--chat-height": `${chatHeight}px` } as CSSProperties) : undefined),
    [chatHeight]
  );

  /**
   * Opening a Group marks it read -- the step this page never took.
   *
   * A Group IS a conversation (`group.id` is the conversation id, which is
   * why `getMessagesAction(group.id)` works), but reading one is not the same
   * as opening one from the inbox: direct chats and Plan Chat both live inside
   * `/messages`, which calls `markConversationReadAction` when a thread is
   * selected. A Group opens at its own route, so nothing on the path ever
   * cleared the unread state. The messages were visibly read and the badge
   * kept counting them.
   *
   * The authority is the shared one, not a Group-specific projection:
   * `markConversationRead` re-checks `resolveConversationAccess` and writes
   * only this user's `last_read_message_id`. `MESSAGES_UPDATED_EVENT` is the
   * same signal `/messages` dispatches, so the nav badge and the inbox both
   * reconcile against the server without a hard refresh.
   *
   * Keyed on the newest message id so it re-marks when a message arrives while
   * the Group is already open -- otherwise the badge would start counting
   * again for messages sitting on screen.
   */
  const newestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (!newestMessageId) return;
    let disposed = false;
    void (async () => {
      try {
        await markConversationReadAction(group.id);
      } catch {
        // A failed mark leaves the server count intact; the badge stays
        // truthful rather than clearing something that is still unread.
        return;
      }
      if (!disposed) window.dispatchEvent(new Event(MESSAGES_UPDATED_EVENT));
    })();
    return () => {
      disposed = true;
    };
  }, [group.id, newestMessageId]);

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let disposed = false;

    const performRefresh = async () => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        const loaded = await withTimeout(getMessagesAction(group.id), {
          operation: "refresh group messages"
        });
        if (!disposed) setMessages(loaded);
      } catch {
        if (!disposed) setFeedback("Group messages could not be refreshed.");
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          refreshTimer = setTimeout(() => void performRefresh(), 150);
        }
      }
    };
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void performRefresh(), 150);
    };

    const channel = supabase
      .channel(`group-messages:${group.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${group.id}` },
        scheduleRefresh
      );

    /**
     * A dropped socket replays nothing, so reaching SUBSCRIBED again is the
     * only signal that messages may have been missed.
     *
     * Without this a Group chat went quietly stale: the phone sleeps, the
     * WebSocket dies without ever reporting CLOSED, and the thread keeps
     * showing whatever it had when the screen went off. Reopening the app was
     * the only cure -- the same restart-to-see-your-messages problem the direct
     * inbox had. The first SUBSCRIBED is the normal start of a fresh
     * subscription and needs no refresh; every one after it is a reconnect.
     */
    let hasSubscribedOnce = false;

    // Authenticate the socket before subscribing: this filter is on an
    // RLS-protected table, and a socket carrying only the publishable key sees
    // nothing through RLS and is closed with CHANNEL_ERROR.
    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe((status) => {
        if (disposed || status !== "SUBSCRIBED") return;
        if (hasSubscribedOnce) scheduleRefresh();
        hasSubscribedOnce = true;
      });
    });

    /* The correctness net for what Realtime cannot see: a phone that slept
       through a message, or a restrictive network that drops the socket
       without surfacing an error. Only fires on a real resume, never on a
       timer, so it costs nothing while the app sits idle. */
    const resumeRefresh = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    document.addEventListener("visibilitychange", resumeRefresh);
    window.addEventListener("focus", resumeRefresh);

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", resumeRefresh);
      window.removeEventListener("focus", resumeRefresh);
      void supabase.removeChannel(channel);
    };
  }, [group.id, setFeedback]);

  function invite(candidate: GroupInviteCandidate) {
    startTransition(async () => {
      const result = await inviteGroupMemberAction({ groupId: group.id, userId: candidate.userId });
      setFeedback(result.message);
      if (result.ok) setCandidates((current) => current.filter((item) => item.userId !== candidate.userId));
    });
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-5 pt-6">
      <div className="flex items-center justify-between gap-3">
        {/* Back goes where the person actually came from.
            This was a hardcoded link to /groups, so opening a Group from the
            Messages inbox and pressing Back dropped you on the Groups list --
            a place you had not been -- and the label still said "Groups", the
            pre-rename word. A Group chat is reachable from Messages, from the
            Groups list, from a notification and from a deep link; only one of
            those wants /groups.

            router.back() when this page was pushed from somewhere inside the
            app, which is the same history-first convention the direct thread
            uses. A cold deep link has no in-app entry to return to, so it
            falls back to the canonical Groups list rather than leaving the
            browser. */}
        <button
          type="button"
          onClick={() => {
            if (cameFromInsideApp) router.back();
            else router.push("/groups");
          }}
          className="focus-ring safe-motion -mx-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        <div className="flex items-center gap-2">
          {group.canManageMembers ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Invite
            </Button>
          ) : null}
          {group.role !== "owner" ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Leave Group"
              title="Leave Group"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await leaveGroupAction(group.id);
                  setFeedback(result.message);
                  if (result.ok) router.push("/groups");
                });
              }}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <header className="flex items-start gap-4 rounded-2xl border border-border/70 bg-card/50 p-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Users2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{group.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
          </p>
          {group.description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.description}</p> : null}
        </div>
      </header>

      {feedback ? <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm" role="status">{feedback}</p> : null}

      <nav className="border-b border-border/70" aria-label="Group sections">
        <div className="flex gap-1">
          {(["chat", "members", "media"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium capitalize",
                tab === item ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </nav>

      {tab === "chat" ? (
        /* THE CHAT FILLS WHAT THE PHONE ACTUALLY LEAVES IT.
         *
         * This was `h-[min(620px,65vh)]`, a fixed card rather than a viewport.
         * On a 844px-tall phone 65vh is 549px, so the conversation ended part
         * way up the screen with a large dead region beneath it and the bottom
         * navigation floating further down still -- the composer never sat
         * where a chat's composer belongs.
         *
         * `vh` is also the wrong unit on a phone: iOS measures it against the
         * viewport WITHOUT browser chrome, so it over-reports and content can
         * ride up under the status area. `svh` is the small-viewport unit --
         * the height that is always visible, chrome showing -- so the panel
         * cannot be taller than what the user can actually see.
         *
         * What is subtracted is what genuinely sits outside the chat: the app
         * header (which already includes the top inset), this page's own header
         * and tab bar, the bottom navigation, and the bottom safe area. The
         * result is a real filling column -- messages take the remainder,
         * composer stays attached to the bottom of it -- while `max-h` keeps a
         * desktop window from stretching one conversation absurdly tall. The
         * min-height still protects the layout on a very short window. */
        <section
          /* The height is measured from where the panel actually STARTS, not
             from a guessed stack of header and tab heights. Everything above
             this section -- app header, page header, the member strip, the tab
             bar -- varies with content and with the phone's top inset, so any
             fixed subtraction is wrong on some device: too tall and the
             composer slides under the bottom navigation, too short and the
             dead region comes back. `--chat-top` is set from the element's own
             offset on mount and on resize, so the panel takes exactly the room
             that is left. The static calc is the pre-hydration fallback. */
          ref={chatPanelRef}
          style={chatPanelStyle}
          className="flex h-[var(--chat-height,15rem)] max-h-[720px] min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/25 md:h-[min(620px,65svh)] md:max-h-none md:min-h-[420px]"
          aria-label={`${group.name} chat`}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {messages.length > 0 ? messages.map((message, messageIndex) => {
              const previous = messages[messageIndex - 1];
              const newRun = startsNewRun(message, previous);
              const newDay = startsNewDay(message.createdAt, previous?.createdAt);
              // Identity heads the run, not every bubble. Own messages carry
              // no identity block at all — the trailing alignment and primary
              // fill already say "you", the same as in a direct conversation.
              const showIdentity = newRun && !message.isMine;

              if (message.messageType === "system") {
                return (
                  <div key={message.id}>
                    {newDay ? (
                      <p className="py-2 text-center text-[11px] font-medium text-muted-foreground">
                        {new Date(message.createdAt).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric"
                        })}
                      </p>
                    ) : null}
                    {/* Quiet by design: centred, small, no bubble, no avatar.
                        A group event is context, not conversation.

                        aria-hidden is deliberate — a thread of history would
                        otherwise make a screen reader read every past role
                        change on load. The facts stay visible; they are simply
                        not announced as new messages. */}
                    <p
                      className="px-6 py-2 text-center text-xs text-muted-foreground"
                      aria-hidden="true"
                    >
                      {message.text}
                    </p>
                  </div>
                );
              }

              return (
                <div key={message.id}>
                  {newDay ? (
                    <p className="py-2 text-center text-[11px] font-medium text-muted-foreground">
                      {new Date(message.createdAt).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric"
                      })}
                    </p>
                  ) : null}

                  <div
                    className={cn(
                      "flex items-end gap-2",
                      message.isMine ? "justify-end" : "justify-start",
                      newRun ? "mt-3 first:mt-0" : "mt-0.5"
                    )}
                  >
                    {/* Avatar gutter. Reserved on every incoming row so the
                        bubbles in a run stay left-aligned with each other
                        instead of stepping sideways under the first one. */}
                    {!message.isMine ? (
                      <div className="w-8 shrink-0 self-end">
                        {showIdentity ? (
                          message.senderUnavailable || !message.senderUsername ? (
                            <UserAvatar name={message.senderName} size="xs" decorative />
                          ) : (
                            <Link
                              href={`/friends/${message.senderUsername}`}
                              // 44px target around a 32px avatar, without
                              // changing the visual size.
                              className="focus-ring -m-1.5 grid h-11 w-11 place-items-center rounded-full p-1.5"
                              aria-label={`View ${message.senderName}'s profile`}
                            >
                              <UserAvatar
                                src={message.senderAvatarUrl}
                                name={message.senderName}
                                size="xs"
                                decorative
                              />
                            </Link>
                          )
                        ) : null}
                      </div>
                    ) : null}

                    <div className={cn("max-w-[78%]", message.isMine && "flex flex-col items-end")}>
                      {showIdentity ? (
                        <p className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
                          {message.senderName}
                          {/* The canonical badge — never a Groups-specific one. */}
                          <PremiumPlanBadge plan={message.senderPlan} compact />
                          {/* THREE distinct signals on this line, never merged:
                              premium is a plan, this is standing across the
                              product, and the role below is authority in THIS
                              group. Icon-only here so a name, a badge, a mark
                              and a role still fit one line on a phone. */}
                          <TrustedMemberMark trustedSince={message.senderTrustedSince} compact />
                          <VerifiedAccountMark isVerifiedAccount={message.senderIsVerifiedAccount} compact />
                          {/* Role indicator, deliberately the quietest thing
                              on the line: plain text, muted, no colour and no
                              pill, so it never competes with the name or with
                              Plus/Pro identity. "Member" is never shown —
                              labelling the ordinary case on every message is
                              noise, not information. */}
                          {message.senderRole === "owner" || message.senderRole === "admin" ? (
                            <span className="font-normal text-muted-foreground/70">
                              {message.senderRole === "owner" ? "Owner" : "Admin"}
                            </span>
                          ) : null}
                        </p>
                      ) : null}

                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2 text-sm leading-6",
                          message.isMine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                        )}
                      >
                        {/* One label carries author + time, so a screen reader
                            announces "Message from Ama, 10:42 PM" once rather
                            than re-reading the avatar and name per bubble. */}
                        <p className="sr-only">
                          {message.isMine ? "Your message" : `Message from ${message.senderName}`},{" "}
                          {new Date(message.createdAt).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit"
                          })}
                        </p>
                        {message.attachment ? (
                          <MessageAttachmentImage
                            conversationId={group.id}
                            message={message}
                            onOpen={() => setViewerMessageId(message.id)}
                            onRefreshed={(next) => setMessages((current) => current.map((item) =>
                              item.id === message.id ? { ...item, attachment: next } : item
                            ))}
                          />
                        ) : null}
                        {message.voice ? (
                          <VoiceMessageBubble
                            conversationId={group.id}
                            messageId={message.id}
                            senderName={message.isMine ? "you" : message.senderName}
                            asset={message.voice}
                          />
                        ) : null}
                        {/* The caption, when there is one. A photo alone is a
                            complete message, so no placeholder text is
                            invented for it. */}
                        {message.text ? (
                          <p>
                            <MessageText text={message.text} mentions={message.mentions} />
                          </p>
                        ) : message.attachment || message.voice ? null : (
                          <p>Message</p>
                        )}
                        <p
                          aria-hidden="true"
                          className={cn(
                            "mt-1 text-[10px]",
                            message.isMine ? "text-primary-foreground/70" : "text-muted-foreground"
                          )}
                        >
                          {formatRelativeTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <EmptyState
                icon={Users2}
                className="!border-0 !bg-transparent !shadow-none"
                title="Start the conversation"
                description="Messages in this Group are visible only to joined members."
              />
            )}
          </div>
          <MessageComposer
            conversationId={group.id}
            voiceRecorderConfig={voiceRecorderConfig}
            // A group is exactly where "who did you mean" is a real question.
            isGroup
            /* The Group's own member list, already loaded and authorised by
               this page. Not a second query, and not a second authority --
               the server re-validates every mentioned id on send regardless. */
            mentionCandidates={mentionCandidates}
            placeholder="Message the Group"
            onFeedback={setFeedback}
            onSent={async () => {
              const loaded = await withTimeout(getMessagesAction(group.id), {
                operation: "refresh group messages"
              });
              if (mountedRef.current) setMessages(loaded);
            }}
          />
        </section>
      ) : null}

      {tab === "media" ? (
        <section aria-labelledby="group-media-heading" className="space-y-3">
          <h2 id="group-media-heading" className="text-sm font-semibold">Shared Media</h2>
          {/* Built from the messages already loaded and authorised for this
              viewer — never a second copy of attachment metadata, and never a
              query that could return media the thread would not show.
              Files and Links are deliberately absent until they exist. */}
          {mediaMessages.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {mediaMessages.map((item) => (
                <li key={item.id}>
                  <MessageAttachmentImage
                    conversationId={group.id}
                    message={item}
                    square
                    onOpen={() => setViewerMessageId(item.id)}
                    onRefreshed={(next) => setMessages((current) => current.map((message) =>
                      message.id === item.id ? { ...message, attachment: next } : message
                    ))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users2}
              className="!border-0 !bg-transparent !shadow-none"
              title="No media yet"
              description="Photos shared in this Group will appear here."
            />
          )}
        </section>
      ) : null}

      {tab === "members" ? (
        <div className="space-y-6">
          <section aria-labelledby="group-members-heading" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 id="group-members-heading" className="text-sm font-semibold">
                {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
              </h2>
              {group.canManageMembers ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Add
                </Button>
              ) : null}
            </div>

            {/* Owner, then Admins, then Members — authority order, never
                premium order. `orderGroupMembers` is what guarantees that. */}
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card/50">
              {orderedMembers.map((member) => {
                const actions = memberActions({
                  viewerRole: group.role,
                  viewerId: group.viewerId,
                  member,
                  hasProfileRoute: Boolean(member.username)
                });
                const label = roleLabel(member.role);
                const isSelf = member.userId === group.viewerId;

                // Same actions the More button opens, reached by holding the
                // row. The button stays: the hold is a shortcut, never the
                // only route.
                const menuItems = actions.map((action) => ({
                  id: action,
                  label: MEMBER_ACTION_LABELS[action],
                  destructive: action === "remove_member" || action === "leave_group",
                  disabled: isPending,
                  onSelect: () => runMemberAction(action, member)
                }));

                return (
                  <li key={member.userId}>
                  <LongPressActions items={menuItems} label={`Actions for ${member.displayName}`}>
                  <span className="flex items-center gap-3 p-3">
                    <UserAvatar
                      src={member.avatarUrl}
                      name={member.displayName}
                      size="sm"
                      decorative
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{member.displayName}</span>
                        {isSelf ? <span className="shrink-0 text-xs text-muted-foreground">You</span> : null}
                        <PremiumPlanBadge plan={member.plan} compact />
                        {/* Presentation only. The list is still ordered
                            Owner → Admins → Members → name; standing never
                            buys a position in it. */}
                        <VerifiedAccountMark isVerifiedAccount={member.isVerifiedAccount} compact />
                        <TrustedMemberMark trustedSince={member.trustedSince} compact />
                      </p>
                      {/* Authority is stated in words, not colour alone, so it
                          survives a screen reader and a colour-blind viewer. */}
                      <p className="truncate text-xs text-muted-foreground">
                        @{member.username}
                        {label ? <span className="ml-1.5 font-medium text-foreground/70">· {label}</span> : null}
                      </p>
                    </div>

                    {actions.length > 0 ? (
                      <AppMenu
                        label={`Actions for ${member.displayName}`}
                        items={menuItems}
                        trigger={
                          <button
                            type="button"
                            aria-label={`Actions for ${member.displayName}`}
                            className="focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                          >
                            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                          </button>
                        }
                      />
                    ) : null}
                  </span>
                  </LongPressActions>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Leaving lives at the foot, away from the member rows, so it is
              never the thing under a mis-tap. The owner sees the transfer
              route instead of a Leave button that would always fail. */}
          <section aria-labelledby="group-discovery-heading" className="space-y-2">
            <h2 id="group-discovery-heading" className="text-sm font-semibold">
              Discovery
            </h2>
            {group.role === "owner" ? (
              <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
                <p className="text-sm font-medium">
                  {group.visibility === "public" ? "Public group" : "Private group"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {group.visibility === "public"
                    ? "Anyone on Mad Buddy can find this group on Linkr. Members are never listed publicly — only the name, description and member count."
                    : "Only people you invite can find this group. Make it public to let others discover it on Linkr."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={isPending}
                  onClick={() => {
                    if (isPending) return;
                    startTransition(async () => {
                      const result = await setGroupVisibilityAction({
                        groupId: group.id,
                        visibility: group.visibility === "public" ? "private" : "public"
                      });
                      setFeedback(result.message);
                      if (result.ok) router.refresh();
                    });
                  }}
                >
                  {group.visibility === "public" ? "Make private" : "Make public"}
                </Button>
                {/* Visibility and joining are separate: a public group can
                    still require an invitation, and this control never
                    silently opens the door. */}
                {group.visibility === "public" && group.joinMode !== "link" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    People can find this group but still need an invitation to join.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="rounded-2xl border border-border/70 bg-card/50 p-4 text-xs text-muted-foreground">
                {group.visibility === "public"
                  ? "This group is public — anyone can find it on Linkr."
                  : "This group is private. Only invited people can find it."}
              </p>
            )}
          </section>

          <section aria-labelledby="group-danger-heading" className="space-y-2">
            <h2 id="group-danger-heading" className="text-sm font-semibold">
              Leaving this group
            </h2>
            {group.role === "owner" ? (
              <div className="rounded-2xl border border-border/70 bg-card/50 p-4">
                <p className="text-sm text-muted-foreground">
                  You own this group. Transfer ownership to another member before you can leave.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={isPending || ownershipOptions.length === 0}
                  onClick={() => setTransferOpen(true)}
                >
                  Transfer ownership
                </Button>
                {ownershipOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    There is no one else in this group to transfer to yet.
                  </p>
                ) : null}
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="text-destructive"
                disabled={isPending}
                onClick={() => setConfirm({ kind: "leave_group", member: null })}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Leave group
              </Button>
            )}
          </section>
        </div>
      ) : null}

      {/* Confirmation for the actions that cost something. Deliberately names
          the person and states the consequence in one sentence — and says only
          what is true: they lose access to NEW content, which is the whole of
          what removal does. */}
      {/* One immersive viewer, shared with Moments. */}
      <MessageMediaViewer
        message={messages.find((item) => item.id === viewerMessageId) ?? null}
        open={viewerMessageId !== null}
        onClose={() => setViewerMessageId(null)}
      />

      <Modal
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
        title={
          confirm?.kind === "leave_group"
            ? "Leave this group?"
            : `Remove ${confirm?.member?.displayName ?? "this member"}?`
        }
        description={
          confirm?.kind === "leave_group"
            ? "You'll stop receiving new messages from this group."
            : `${confirm?.member?.displayName ?? "They"} will lose access to new messages in this group.`
        }
        compact
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isPending}
              onClick={() => confirm && applyRole(confirm.kind, confirm.member)}
            >
              {isPending ? "Working..." : confirm?.kind === "leave_group" ? "Leave group" : "Remove"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">This can be undone by adding them again later.</p>
      </Modal>

      {/* Ownership transfer: a deliberate two-step flow, never a tap in an
          overflow menu. The copy states all three consequences plainly. */}
      <Modal
        open={transferOpen}
        onOpenChange={(next) => {
          setTransferOpen(next);
          if (!next) setTransferTarget(null);
        }}
        title="Transfer ownership"
        description="Choose who takes over this Group."
        variant="sheet"
      >
        {transferTarget ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 p-4">
              <div className="flex items-center gap-3">
                <UserAvatar
                  src={transferTarget.avatarUrl}
                  name={transferTarget.displayName}
                  size="sm"
                  decorative
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{transferTarget.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{transferTarget.username}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                <li>{transferTarget.displayName} gains full control of this group.</li>
                <li>You become an admin.</li>
                <li>This happens immediately.</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTransferTarget(null)} disabled={isPending}>
                Back
              </Button>
              <Button type="button" variant="primary" onClick={confirmTransfer} disabled={isPending}>
                {isPending ? "Transferring..." : "Transfer ownership"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {ownershipOptions.map((member) => (
              <button
                key={member.userId}
                type="button"
                onClick={() => setTransferTarget(member)}
                className="focus-ring safe-motion flex w-full items-center gap-3 rounded-xl border border-border/70 p-3 text-left hover:bg-secondary/40"
              >
                <UserAvatar
                  src={member.avatarUrl}
                  name={member.displayName}
                  size="sm"
                  decorative
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite Muddies"
        description="Invitations require their approval before they join."
      >
        {candidates.length > 0 ? (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {candidates.map((candidate) => (
              <div key={candidate.userId} className="flex items-center gap-3 rounded-xl border border-border/70 p-3">
                <UserAvatar name={candidate.displayName} src={candidate.avatarUrl} size="sm" decorative className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{candidate.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{candidate.username}</p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => invite(candidate)}>Invite</Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={UserPlus}
            className="!min-h-0 !shadow-none p-4"
            title="No Muddies to invite"
            description="Approved Muddies who are not already members will appear here."
          />
        )}
      </Modal>
    </div>
  );
}
