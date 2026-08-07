"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, LogOut, MoreHorizontal, Send, UserPlus, Users2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { getMessagesAction, sendMessageAction } from "@/app/(app)/messaging-actions";
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
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import { startsNewDay, startsNewRun } from "@/lib/messaging/conversation-presence";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { GroupDetailView, GroupInviteCandidate, GroupMemberView } from "@/lib/groups/types";
import {
  MEMBER_ACTION_LABELS,
  memberActions,
  needsConfirmation,
  orderGroupMembers,
  ownershipCandidates,
  roleLabel,
  type MemberAction
} from "@/lib/groups/member-presentation";
import { AppMenu } from "@/components/ui/app-dropdown";
import {
  AttachmentPicker,
  AttachmentPreview,
  discardAttachment,
  type SelectedAttachment
} from "@/components/messaging/attachment-picker";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn, formatRelativeTime } from "@/lib/utils";

type GroupTab = "chat" | "members" | "media";

export function GroupDetailPage({
  group,
  initialMessages
}: {
  group: GroupDetailView;
  initialMessages: ChatMessageView[];
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [tab, setTab] = useState<GroupTab>("chat");
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null);
  // Which message's photo is open full-screen. The id (not the object) so a
  // realtime refresh cannot leave a stale copy of the message on screen.
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    // Authenticate the socket before subscribing: this filter is on an
    // RLS-protected table, and a socket carrying only the publishable key sees
    // nothing through RLS and is closed with CHANNEL_ERROR.
    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      channel.subscribe();
    });

    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [group.id]);

  function sendMessage() {
    const text = draft.trim();
    // A photo with no caption is a complete message, so either one is enough.
    if (!text && !attachment) return;
    setFeedback("");
    startTransition(async () => {
      try {
        const result = await withTimeout(sendMessageAction({
          conversationId: group.id,
          text,
          mediaId: attachment?.mediaId,
          clientMessageId: crypto.randomUUID()
        }), {
          operation: "send group message"
        });
        setFeedback(result.message);
        if (result.ok) {
          setDraft("");
          // Cleared only on success: a failed send must keep both the caption
          // and the uploaded photo so the sender can simply retry.
          setAttachment(null);
          const loaded = await withTimeout(getMessagesAction(group.id), {
            operation: "refresh group messages"
          });
          if (mountedRef.current) setMessages(loaded);
        }
      } catch (error) {
        setFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your message was kept so you can try again."
            : "The message could not be sent. Try again."
        );
      }
    });
  }

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
        <Link href="/groups" className="focus-ring safe-motion inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Groups
        </Link>
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
              aria-label="Leave group"
              title="Leave group"
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
        <section className="flex h-[min(620px,65vh)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/25" aria-label={`${group.name} chat`}>
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
                                membershipTier={publicMembershipTier(message.senderPlan)}
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
                          <button
                            type="button"
                            onClick={() => setViewerMessageId(message.id)}
                            aria-label={attachmentAltText(message.senderName, message.isMine)}
                            className="focus-ring safe-motion -mx-1 mb-1 block overflow-hidden rounded-xl"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                            <img
                              src={message.attachment.thumbUrl ?? ""}
                              alt={attachmentAltText(message.senderName, message.isMine)}
                              loading="lazy"
                              width={message.attachment.width ?? undefined}
                              height={message.attachment.height ?? undefined}
                              className="max-h-64 w-full max-w-[15rem] object-cover"
                            />
                          </button>
                        ) : null}
                        {/* The caption, when there is one. A photo alone is a
                            complete message, so no placeholder text is
                            invented for it. */}
                        {message.text ? (
                          <p>{message.text}</p>
                        ) : message.attachment ? null : (
                          <p>{message.messageType === "voice_note" ? "Voice note" : "Message"}</p>
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
                description="Messages in this group are visible only to joined members."
              />
            )}
          </div>
          <AttachmentPreview
            attachment={attachment}
            onRemove={() => {
              discardAttachment(attachment);
              setAttachment(null);
            }}
          />
          <form
            className="flex items-center gap-2 border-t border-border/70 bg-background/80 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <AttachmentPicker
              conversationId={group.id}
              onAttachmentChange={setAttachment}
              disabled={isPending}
            />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={attachment ? "Add a caption" : "Message the group"}
              maxLength={2000}
              className="flex-1"
              disabled={isPending}
            />
            <Button
              type="submit"
              size="icon"
              disabled={isPending || (!draft.trim() && !attachment)}
              aria-label="Send message"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </form>
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
                  <button
                    type="button"
                    onClick={() => setViewerMessageId(item.id)}
                    aria-label={attachmentAltText(item.senderName, item.isMine)}
                    className="focus-ring safe-motion block aspect-square w-full overflow-hidden rounded-xl"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                    <img
                      src={item.attachment?.thumbUrl ?? ""}
                      alt={attachmentAltText(item.senderName, item.isMine)}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users2}
              className="!border-0 !bg-transparent !shadow-none"
              title="No media yet"
              description="Photos shared in this group will appear here."
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

                return (
                  <li key={member.userId} className="flex items-center gap-3 p-3">
                    <UserAvatar
                      src={member.avatarUrl}
                      name={member.displayName}
                      size="sm"
                      membershipTier={publicMembershipTier(member.plan)}
                      decorative
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{member.displayName}</span>
                        {isSelf ? <span className="shrink-0 text-xs text-muted-foreground">You</span> : null}
                        <PremiumPlanBadge plan={member.plan} compact />
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
                        items={actions.map((action) => ({
                          id: action,
                          label: MEMBER_ACTION_LABELS[action],
                          destructive: action === "remove_member" || action === "leave_group",
                          disabled: isPending,
                          onSelect: () => runMemberAction(action, member)
                        }))}
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
        description="Choose who takes over this group."
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
                  membershipTier={publicMembershipTier(transferTarget.plan)}
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
                  membershipTier={publicMembershipTier(member.plan)}
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
                <GlowAvatar name={candidate.displayName} src={candidate.avatarUrl} size="sm" reducedMotion={reducedMotion} />
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
