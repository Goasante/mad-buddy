"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Loader2, Plus, Search, Shield, Users2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import {
  createGroupAction,
  joinDiscoverableGroupAction,
  respondToGroupInvitationAction
} from "@/app/(app)/group-actions";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { GroupInvitation, GroupSummary, GroupsPageData } from "@/lib/groups/types";
import { cn, formatRelativeTime } from "@/lib/utils";

type GroupTab = "mine" | "discover" | "requests";

const groupTabs: Array<{ id: GroupTab; label: string }> = [
  { id: "mine", label: "My Groups" },
  { id: "discover", label: "Discover" },
  { id: "requests", label: "Invitations" }
];

export function GroupsPageContent({ initialData }: { initialData: GroupsPageData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<GroupTab>("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discoverable, setDiscoverable] = useState(false);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const visibleGroups = useMemo(() => {
    const source = activeTab === "mine" ? data.groups : data.discoverableGroups;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return source;
    return source.filter((group) =>
      `${group.name} ${group.description ?? ""}`.toLowerCase().includes(normalized)
    );
  }, [activeTab, data.discoverableGroups, data.groups, query]);

  function refresh(message: string) {
    setFeedback(message);
    router.refresh();
  }

  function createGroup() {
    startTransition(async () => {
      const result = await createGroupAction({ name, description, discoverable });
      setFeedback(result.message);
      if (!result.ok) return;
      setName("");
      setDescription("");
      setDiscoverable(false);
      setCreateOpen(false);
      setActiveTab("mine");
      router.refresh();
      if (result.groupId) router.push(`/groups/${result.groupId}`);
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Groups</h1>
          <p className="mt-2 text-sm text-muted-foreground">Private spaces for conversations and shared plans.</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create group
        </Button>
      </header>

      {feedback ? <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm" role="status">{feedback}</p> : null}

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Groups tabs">
        <div className="flex min-w-max gap-1">
          {groupTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setQuery("");
              }}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {tab.id === "requests" && data.invitations.length > 0 ? ` (${data.invitations.length})` : ""}
            </button>
          ))}
        </div>
      </nav>

      {activeTab !== "requests" ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={activeTab === "mine" ? "Search your groups" : "Search discoverable groups"}
            className="pl-9"
          />
        </div>
      ) : null}

      {activeTab === "requests" ? (
        data.invitations.length > 0 ? (
          <div className="space-y-3">
            {data.invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                disabled={isPending}
                onRespond={(accept) => {
                  startTransition(async () => {
                    const result = await respondToGroupInvitationAction({ groupId: invitation.id, accept });
                    if (result.ok) {
                      setData((current) => ({
                        ...current,
                        invitations: current.invitations.filter((item) => item.id !== invitation.id)
                      }));
                    }
                    refresh(result.message);
                    if (result.ok && accept && result.groupId) router.push(`/groups/${result.groupId}`);
                  });
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Inbox}
            className="!min-h-0 !shadow-none p-5"
            title="No group invitations"
            description="Invitations from approved Muddies will appear here."
          />
        )
      ) : visibleGroups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              discoverable={activeTab === "discover"}
              disabled={isPending}
              onJoin={() => {
                startTransition(async () => {
                  const result = await joinDiscoverableGroupAction(group.id);
                  if (result.ok) {
                    setData((current) => ({
                      ...current,
                      groups: [{ ...group, role: "member" }, ...current.groups],
                      discoverableGroups: current.discoverableGroups.filter((item) => item.id !== group.id)
                    }));
                  }
                  refresh(result.message);
                  if (result.ok) router.push(`/groups/${group.id}`);
                });
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={activeTab === "discover" ? Search : Users2}
          className="!min-h-0 !shadow-none p-5"
          title={query ? "No matching groups" : activeTab === "discover" ? "No groups to discover" : "No groups yet"}
          description={
            query
              ? "Try another search."
              : activeTab === "discover"
                ? "Discoverable groups created by approved Muddies will appear here."
                : "Create a private group or accept an invitation to get started."
          }
        />
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create group"
        description="Groups are private by default."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>Cancel</Button>
            <Button type="button" onClick={createGroup} disabled={isPending || name.trim().length < 2}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              Create group
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField htmlFor="group-name" label="Group name">
            <Input id="group-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Weekend Crew" />
          </FormField>
          <FormField htmlFor="group-description" label="Description (optional)">
            <Textarea id="group-description" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="What is this group for?" />
          </FormField>
          <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3">
            <input
              type="checkbox"
              checked={discoverable}
              onChange={(event) => setDiscoverable(event.target.checked)}
              className="mt-1 h-4 w-4 accent-blue-500"
            />
            <span>
              <span className="block text-sm font-medium">Allow approved Muddies to discover this group</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Only your approved Muddies can find and join it.</span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

function GroupCard({
  group,
  discoverable,
  disabled,
  onJoin
}: {
  group: GroupSummary;
  discoverable: boolean;
  disabled: boolean;
  onJoin: () => void;
}) {
  return (
    <article className="flex min-h-[220px] flex-col rounded-2xl border border-border/80 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Users2 className="h-5 w-5" aria-hidden="true" />
        </span>
        {group.role === "owner" || group.role === "admin" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" /> {group.role === "owner" ? "Owner" : "Admin"}
          </span>
        ) : null}
      </div>
      <h2 className="mt-3 truncate text-base font-semibold">{group.name}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{group.memberCount} {group.memberCount === 1 ? "member" : "members"}</p>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{group.description || "A private Mad Buddy group."}</p>
      {group.lastMessagePreview ? <p className="mt-2 truncate text-xs text-muted-foreground">{group.lastMessagePreview}</p> : null}
      {group.lastMessageAt ? <p className="mt-1 text-[11px] text-muted-foreground">Active {formatRelativeTime(group.lastMessageAt)}</p> : null}
      <div className="mt-auto pt-4">
        {discoverable ? (
          <Button type="button" size="sm" className="w-full" onClick={onJoin} disabled={disabled}>Join group</Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="w-full" asChild>
            <Link href={`/groups/${group.id}`}>Open group</Link>
          </Button>
        )}
      </div>
    </article>
  );
}

function InvitationRow({
  invitation,
  disabled,
  onRespond
}: {
  invitation: GroupInvitation;
  disabled: boolean;
  onRespond: (accept: boolean) => void;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/50 p-4 sm:flex-row sm:items-center">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Users2 className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{invitation.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{invitation.invitedByName} invited you</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onRespond(false)} disabled={disabled}>Decline</Button>
        <Button type="button" size="sm" onClick={() => onRespond(true)} disabled={disabled}>Join</Button>
      </div>
    </article>
  );
}
