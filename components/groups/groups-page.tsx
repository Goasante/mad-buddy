"use client";

import Link from "next/link";
import { Inbox, Plus, Search, Shield, Users2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { PreviewNotice } from "@/components/ui/preview-notice";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type GroupTab = "mine" | "discover" | "requests";
type Role = "admin" | "member" | "none";

export type GroupItem = {
  id: string;
  name: string;
  memberCount: number;
  description: string;
  role: Role;
  activeNow: boolean;
};

const seedGroups: GroupItem[] = [
  { id: "legon-entrepreneurs", name: "Legon Entrepreneurs", memberCount: 48, description: "A space for Legon entrepreneurs to connect, share ideas, and grow together.", role: "admin", activeNow: true },
  { id: "law-school-24", name: "Law School '24", memberCount: 32, description: "Our graduating class, staying connected.", role: "member", activeNow: true },
  { id: "accra-creators", name: "Accra Creators", memberCount: 156, description: "Creators across Accra sharing work and collaborating.", role: "none", activeNow: false },
  { id: "weekend-crew", name: "Weekend Crew", memberCount: 31, description: "Weekend hangouts, planned here.", role: "member", activeNow: true }
];

const groupTabs: Array<{ id: GroupTab; label: string }> = [
  { id: "mine", label: "My Groups" },
  { id: "discover", label: "Discover" },
  { id: "requests", label: "Requests" }
];

export function GroupsPageContent() {
  const [groups, setGroups] = useState<GroupItem[]>(seedGroups);
  const [activeTab, setActiveTab] = useState<GroupTab>("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");

  const visibleGroups = useMemo(() => {
    if (activeTab === "mine") return groups.filter((group) => group.role !== "none");
    if (activeTab === "discover") return groups.filter((group) => group.role === "none");
    return [];
  }, [groups, activeTab]);

  function joinGroup(id: string) {
    setGroups((current) => current.map((group) => (group.id === id ? { ...group, role: "member", memberCount: group.memberCount + 1 } : group)));
    setFeedback("Joined group.");
  }

  function createGroup() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `group-${Date.now()}`;
    setGroups((current) => [
      { id, name: trimmed, memberCount: 1, description: description.trim(), role: "admin", activeNow: true },
      ...current
    ]);
    setName("");
    setDescription("");
    setCreateOpen(false);
    setActiveTab("mine");
    setFeedback(`"${trimmed}" created.`);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 pt-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Groups</h1>
          <p className="mt-2 text-sm text-muted-foreground">Create or join communities around shared interests.</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Group
        </Button>
      </header>

      <PreviewNotice />

      {feedback ? <p className="text-sm text-muted-foreground" role="status">{feedback}</p> : null}

      <nav className="overflow-x-auto border-b border-border/70" aria-label="Groups tabs">
        <div className="flex min-w-max gap-1">
          {groupTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "requests" ? (
        <EmptyState
          icon={Users2}
          className="!min-h-0 !shadow-none p-5"
          title="No group requests"
          description="Requests to join your groups will appear here."
          action={
            <Button type="button" variant="outline" asChild>
              <Link href="/invites">
                <Inbox className="h-4 w-4" aria-hidden="true" />
                View circle invites
              </Link>
            </Button>
          }
        />
      ) : visibleGroups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleGroups.map((group) => (
            <div key={group.id} className="rounded-2xl border border-border/80 bg-card/60 p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Users2 className="h-5 w-5" aria-hidden="true" />
                </span>
                {group.role === "admin" ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <Shield className="h-3 w-3" aria-hidden="true" /> Admin
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 truncate text-base font-semibold">{group.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {group.memberCount} members {group.activeNow ? "· Active now" : ""}
              </p>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{group.description}</p>
              {group.role === "none" ? (
                <Button type="button" size="sm" className="mt-4 w-full" onClick={() => joinGroup(group.id)}>
                  Join
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" className="mt-4 w-full" asChild>
                  <Link href={`/groups/${group.id}`}>Open</Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={activeTab === "discover" ? Search : Users2}
          className="!min-h-0 !shadow-none p-5"
          title={activeTab === "discover" ? "No groups to discover" : "No groups yet"}
          description={activeTab === "discover" ? "Check back soon for new communities." : "Join or create a group to get started."}
        />
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create Group"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={createGroup} disabled={!name.trim()}>
              Create Group
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField htmlFor="group-name" label="Group name">
            <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Weekend Crew" />
          </FormField>
          <FormField htmlFor="group-description" label="Description (optional)">
            <Textarea id="group-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What's this group about?" />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

export { seedGroups };
