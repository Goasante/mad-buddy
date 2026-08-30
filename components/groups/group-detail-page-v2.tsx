"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, ChevronRight, LogOut, MessageCircle, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  demoteGroupAdminAction,
  inviteGroupMemberAction,
  leaveGroupAction,
  promoteGroupAdminAction,
  removeGroupMemberAction,
  transferGroupOwnershipAction
} from "@/app/(app)/group-actions";
import { MessageMediaViewer } from "@/components/messaging/message-media-viewer";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { TrustedMemberMark } from "@/components/trust/trusted-member-mark";
import { VerifiedAccountMark } from "@/components/trust/verified-account-mark";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  MEMBER_ACTION_LABELS,
  memberActions,
  orderGroupMembers,
  ownershipCandidates,
  roleLabel,
  type MemberAction
} from "@/lib/groups/member-presentation";
import type { GroupDetailView, GroupInviteCandidate, GroupMemberView } from "@/lib/groups/types";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import { cn } from "@/lib/utils";

type Tab = "members" | "media" | "about";

type ConfirmAction = {
  action: "remove_member" | "leave_group";
  member: GroupMemberView | null;
} | null;

export function GroupDetailPageV2({
  group,
  initialMessages
}: {
  group: GroupDetailView;
  initialMessages: ChatMessageView[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("members");
  const [feedback, setFeedback] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<GroupMemberView | null>(null);
  const [viewerMessageId, setViewerMessageId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const members = useMemo(() => orderGroupMembers(group.members), [group.members]);
  const media = useMemo(() => initialMessages.filter((message) => message.attachment).reverse(), [initialMessages]);
  const transferCandidates = useMemo(() => ownershipCandidates(group.members, group.viewerId), [group.members, group.viewerId]);
  const inviteCandidates = useMemo(() => {
    const term = inviteQuery.trim().toLowerCase();
    return term
      ? group.inviteCandidates.filter((candidate) => `${candidate.displayName} ${candidate.username}`.toLowerCase().includes(term))
      : group.inviteCandidates;
  }, [group.inviteCandidates, inviteQuery]);

  function runAction(action: MemberAction, member: GroupMemberView) {
    if (action === "view_profile") {
      router.push(`/friends/${member.username}`);
      return;
    }
    if (action === "transfer_ownership") {
      setTransferOpen(true);
      return;
    }
    if (action === "leave_group") {
      setConfirm({ action: "leave_group", member: null });
      return;
    }
    if (action === "remove_member") {
      setConfirm({ action: "remove_member", member });
      return;
    }
    startTransition(async () => {
      const payload = { groupId: group.id, userId: member.userId };
      const result = action === "promote_to_admin"
        ? await promoteGroupAdminAction(payload)
        : await demoteGroupAdminAction(payload);
      setFeedback(result.message);
      if (result.ok) router.refresh();
    });
  }

  function confirmDestructive() {
    if (!confirm) return;
    startTransition(async () => {
      const result = confirm.action === "leave_group"
        ? await leaveGroupAction(group.id)
        : confirm.member
          ? await removeGroupMemberAction({ groupId: group.id, userId: confirm.member.userId })
          : { ok: false, message: "That action is not available." };
      setFeedback(result.message);
      setConfirm(null);
      if (!result.ok) return;
      if (confirm.action === "leave_group") router.push("/groups");
      else router.refresh();
    });
  }

  function transferOwnership() {
    if (!transferTarget) return;
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

  function invite(candidate: GroupInviteCandidate) {
    startTransition(async () => {
      const result = await inviteGroupMemberAction({ groupId: group.id, userId: candidate.userId });
      setFeedback(result.message);
      if (result.ok) {
        setInviteOpen(false);
        setInviteQuery("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-8">
      <div className="sticky top-0 z-20 -mx-1 flex items-center gap-2 border-b border-border/50 bg-background/88 px-1 py-2 backdrop-blur-xl">
        <button type="button" onClick={() => router.back()} className="focus-ring grid h-11 w-11 place-items-center rounded-full transition-transform active:scale-90" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1"><strong className="block truncate text-sm">Group details</strong><span className="block truncate text-[11px] text-muted-foreground">{group.memberCount} members</span></div>
        <Button onClick={() => router.push(`/messages?conversation=${group.id}`)} className="rounded-full"><MessageCircle className="h-4 w-4" />Open chat</Button>
      </div>

      {feedback ? <div role="status" className="mt-3 rounded-2xl border border-[#E88C2B]/20 bg-[#E88C2B]/8 px-4 py-3 text-sm text-[#4E0401] animate-in fade-in slide-in-from-top-1">{feedback}</div> : null}

      <section className="mt-4 overflow-hidden rounded-[28px] border border-border/60 bg-card/60 shadow-[0_20px_55px_rgba(78,4,1,.06)]">
        <div className="flex flex-col items-center px-5 pb-5 pt-7 text-center">
          <UserAvatar name={group.name} src={group.imageUrl} size="lg" decorative className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]" />
          <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-[#4E0401] dark:text-orange-50">{group.name}</h1>
          <p className="mt-1 text-xs font-medium text-muted-foreground">{group.memberCount} members · {group.visibility === "public" ? "Public" : "Private"} · {group.joinMode === "link" ? "Open to join" : "Invite only"}</p>
          {group.description ? <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{group.description}</p> : null}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => router.push(`/messages?conversation=${group.id}`)}><MessageCircle className="h-4 w-4" />Message Group</Button>
            {group.canManageMembers ? <Button variant="outline" onClick={() => setInviteOpen(true)}><UserPlus className="h-4 w-4" />Add people</Button> : null}
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-border/50">
          {(["members", "media", "about"] as const).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={cn("relative min-h-12 text-xs font-bold capitalize transition", tab === item ? "text-[#E88C2B]" : "text-muted-foreground")}><span>{item}</span>{tab === item ? <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-[#E88C2B] animate-in zoom-in-x" /> : null}</button>)}
        </div>
      </section>

      {tab === "members" ? (
        <section className="mt-4 overflow-hidden rounded-[24px] border border-border/60 bg-card/60">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3"><div><strong className="block text-sm">Members</strong><span className="text-[11px] text-muted-foreground">Owner → admins → members</span></div>{group.canManageMembers ? <button type="button" onClick={() => setInviteOpen(true)} className="focus-ring grid h-10 w-10 place-items-center rounded-full bg-[#E88C2B]/10 text-[#E88C2B]" aria-label="Add members"><UserPlus className="h-4 w-4" /></button> : null}</div>
          <ul className="divide-y divide-border/45">
            {members.map((member) => {
              const actions = memberActions({ viewerRole: group.role, viewerId: group.viewerId, member, hasProfileRoute: Boolean(member.username) });
              return <li key={member.userId} className="flex min-h-[70px] items-center gap-3 px-3 py-2.5">
                <UserAvatar src={member.avatarUrl} name={member.displayName} size="sm" />
                <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5"><strong className="truncate text-sm">{member.displayName}</strong><PremiumPlanBadge plan={member.plan} compact /><TrustedMemberMark trustedSince={member.trustedSince} compact /><VerifiedAccountMark isVerifiedAccount={member.isVerifiedAccount} compact /></div><div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="truncate">@{member.username}</span>{roleLabel(member.role) ? <span className="rounded-full bg-[#E88C2B]/10 px-2 py-0.5 font-bold text-[#E88C2B]">{roleLabel(member.role)}</span> : null}{member.userId === group.viewerId ? <span>· You</span> : null}</div></div>
                {actions.length > 0 ? <AppMenu label={`Actions for ${member.displayName}`} align="end" items={actions.map((action) => ({ id: action, label: MEMBER_ACTION_LABELS[action], onSelect: () => runAction(action, member) }))} trigger={<button type="button" className="focus-ring grid h-10 min-w-10 place-items-center rounded-full text-lg font-bold text-muted-foreground" aria-label={`Actions for ${member.displayName}`}>•••</button>} /> : null}
              </li>;
            })}
          </ul>
        </section>
      ) : null}

      {tab === "media" ? (
        <section className="mt-4 rounded-[24px] border border-border/60 bg-card/60 p-3">
          <div className="mb-3 flex items-center gap-2"><Camera className="h-4 w-4 text-[#E88C2B]" /><strong className="text-sm">Shared photos</strong><span className="ml-auto text-xs text-muted-foreground">{media.length}</span></div>
          {media.length === 0 ? <div className="grid min-h-44 place-items-center rounded-2xl bg-secondary/35 text-center"><div><Camera className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No shared photos yet</p><button type="button" onClick={() => router.push(`/messages?conversation=${group.id}`)} className="mt-2 text-xs font-bold text-[#E88C2B]">Open chat to share one</button></div></div> : <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">{media.map((message) => <button key={message.id} type="button" onClick={() => setViewerMessageId(message.id)} className="focus-ring aspect-square overflow-hidden rounded-xl bg-secondary transition-transform active:scale-95" aria-label={`Open photo from ${message.senderName}`}>{message.attachment?.thumbUrl || message.attachment?.fullUrl ? <img src={message.attachment.thumbUrl ?? message.attachment.fullUrl ?? ""} alt="" className="h-full w-full object-cover" /> : null}</button>)}</div>}
        </section>
      ) : null}

      {tab === "about" ? (
        <section className="mt-4 space-y-3">
          <div className="rounded-[24px] border border-border/60 bg-card/60 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#E88C2B]" /><strong className="text-sm">Group authority</strong></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">Your role is <strong className="text-foreground">{group.role ?? "member"}</strong>. Chat permissions, polls, pins and message-lifetime controls live in Group Settings inside the canonical chat.</p><button type="button" onClick={() => router.push(`/messages?conversation=${group.id}`)} className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border/60 px-3 py-3 text-left"><span><strong className="block text-sm">Open Group Settings</strong><span className="text-xs text-muted-foreground">Chat behaviour, permissions and notifications</span></span><ChevronRight className="h-4 w-4" /></button></div>
          <div className="rounded-[24px] border border-border/60 bg-card/60 p-4"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-[#E88C2B]" /><strong className="text-sm">Membership</strong></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{group.visibility === "public" ? "Anyone signed in can discover this group." : "Only people with access can discover this group."} {group.joinMode === "link" ? "People who are eligible can join without a manual invitation." : "New members join by invitation."}</p></div>
          {group.role !== "owner" ? <Button variant="outline" className="w-full border-destructive/25 text-destructive" onClick={() => setConfirm({ action: "leave_group", member: null })}><LogOut className="h-4 w-4" />Leave Group</Button> : <Button variant="outline" className="w-full" onClick={() => setTransferOpen(true)}>Transfer ownership</Button>}
        </section>
      ) : null}

      <Modal open={inviteOpen} onOpenChange={setInviteOpen} title="Add people" variant="sheet">
        <div className="space-y-3"><Input value={inviteQuery} onChange={(event) => setInviteQuery(event.target.value)} placeholder="Search Muddies" autoFocus />{inviteCandidates.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No eligible Muddies to invite.</p> : <ul className="max-h-[55vh] space-y-1 overflow-y-auto">{inviteCandidates.map((candidate) => <li key={candidate.userId}><button type="button" disabled={isPending} onClick={() => invite(candidate)} className="focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left hover:bg-secondary/70"><UserAvatar src={candidate.avatarUrl} name={candidate.displayName} size="sm" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{candidate.displayName}</strong><span className="block truncate text-xs text-muted-foreground">@{candidate.username}</span></span><UserPlus className="h-4 w-4 text-[#E88C2B]" /></button></li>)}</ul>}</div>
      </Modal>

      <Modal open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)} title={confirm?.action === "leave_group" ? "Leave Group?" : "Remove member?"} compact>
        <p className="text-sm leading-relaxed text-muted-foreground">{confirm?.action === "leave_group" ? "You will stop receiving this Group's messages and updates. You can only return through a new invite or eligible join flow." : `${confirm?.member?.displayName ?? "This member"} will lose access to this Group and its future chat.`}</p>
        <div className="mt-4 flex gap-2"><Button variant="outline" className="flex-1" onClick={() => setConfirm(null)} disabled={isPending}>Cancel</Button><Button className="flex-1" onClick={confirmDestructive} disabled={isPending}>{isPending ? "Working…" : "Confirm"}</Button></div>
      </Modal>

      <Modal open={transferOpen} onOpenChange={setTransferOpen} title="Transfer ownership" variant="sheet">
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Choose the member who should become the new owner. You will become an admin after the transfer.</p>
        <ul className="max-h-[45vh] space-y-1 overflow-y-auto">{transferCandidates.map((member) => <li key={member.userId}><button type="button" onClick={() => setTransferTarget(member)} className={cn("focus-ring flex w-full items-center gap-3 rounded-2xl p-2.5 text-left", transferTarget?.userId === member.userId ? "bg-[#E88C2B]/10 ring-1 ring-[#E88C2B]/30" : "hover:bg-secondary/70")}><UserAvatar src={member.avatarUrl} name={member.displayName} size="sm" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{member.displayName}</strong><span className="text-xs text-muted-foreground">{roleLabel(member.role) ?? "Member"}</span></span></button></li>)}</ul>
        <Button className="mt-4 w-full" onClick={transferOwnership} disabled={isPending || !transferTarget}>{isPending ? "Transferring…" : "Transfer ownership"}</Button>
      </Modal>

      <MessageMediaViewer message={initialMessages.find((message) => message.id === viewerMessageId) ?? null} open={Boolean(viewerMessageId)} onClose={() => setViewerMessageId(null)} />
    </div>
  );
}
