"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, LogOut, Send, UserPlus, Users2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { getMessagesAction, sendMessageAction } from "@/app/(app)/messaging-actions";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import { inviteGroupMemberAction, leaveGroupAction } from "@/app/(app)/group-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { GroupDetailView, GroupInviteCandidate } from "@/lib/groups/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn, formatRelativeTime } from "@/lib/utils";

type GroupTab = "chat" | "members";

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
  const [feedback, setFeedback] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [candidates, setCandidates] = useState(group.inviteCandidates);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = supabase
      .channel(`group-messages:${group.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${group.id}` },
        () => void getMessagesAction(group.id).then(setMessages)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [group.id]);

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    setFeedback("");
    startTransition(async () => {
      const result = await sendMessageAction({
        conversationId: group.id,
        text,
        clientMessageId: crypto.randomUUID()
      });
      setFeedback(result.message);
      if (result.ok) {
        setDraft("");
        setMessages(await getMessagesAction(group.id));
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
          {(["chat", "members"] as const).map((item) => (
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
            {messages.length > 0 ? messages.map((message) => (
              <div key={message.id} className={cn("flex", message.isMine ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-2 text-sm leading-6",
                  message.isMine ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                )}>
                  {!message.isMine ? <p className="mb-0.5 text-xs font-semibold opacity-80">{message.senderName}</p> : null}
                  <p>{message.text || (message.messageType === "voice_note" ? "Voice note" : "Message")}</p>
                  <p className={cn("mt-1 text-[10px]", message.isMine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                    {formatRelativeTime(message.createdAt)}
                  </p>
                </div>
              </div>
            )) : (
              <EmptyState
                icon={Users2}
                className="!border-0 !bg-transparent !shadow-none"
                title="Start the conversation"
                description="Messages in this group are visible only to joined members."
              />
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border/70 bg-background/80 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message the group"
              maxLength={2000}
              className="flex-1"
              disabled={isPending}
            />
            <Button type="submit" size="icon" disabled={isPending || !draft.trim()} aria-label="Send message">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </form>
        </section>
      ) : null}

      {tab === "members" ? (
        <section className="space-y-2" aria-label="Group members">
          {group.members.map((member) => (
            <div key={member.userId} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3">
              <GlowAvatar name={member.displayName} src={member.avatarUrl} size="sm" reducedMotion={reducedMotion} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
              </div>
              <span className="text-xs capitalize text-muted-foreground">{member.role}</span>
            </div>
          ))}
        </section>
      ) : null}

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
