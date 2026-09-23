"use client";

import { useRouter } from "next/navigation";
import { ImagePlus, Inbox, Loader2, Plus, Search, Shield, Users2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  createGroupAction,
  respondToGroupInvitationAction,
  uploadGroupImageAction
} from "@/app/(app)/group-actions";
import { FormField } from "@/components/auth/form-field";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import type { GroupInvitation, GroupSummary, GroupsPageData } from "@/lib/groups/types";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { cn, formatRelativeTime } from "@/lib/utils";

type GroupTab = "mine" | "requests";

const groupTabs: Array<{ id: GroupTab; label: string }> = [
  { id: "mine", label: "My Groups" },
  { id: "requests", label: "Invitations" }
];

export function GroupsPageContent({
  initialData,
  embedded = false,
  onNavigate
}: {
  initialData: GroupsPageData;
  embedded?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<GroupTab>("mine");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageMediaId, setImageMediaId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const visibleGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return data.groups;
    return data.groups.filter((group) =>
      `${group.name} ${group.description ?? ""}`.toLowerCase().includes(normalized)
    );
  }, [data.groups, query]);

  function openGroup(groupId: string) {
    onNavigate?.();
    router.push(`/messages?conversation=${groupId}`);
  }

  function refresh(message: string) {
    setFeedback(message);
    router.refresh();
  }

  function pickImage(file: File) {
    setUploading(true);
    setFeedback("");
    startTransition(async () => {
      const { compressImageForUpload } = await import("@/lib/media/client-compress");
      const compressed = await compressImageForUpload(file).catch(() => null);
      const prepared = compressed?.ok ? compressed.file : file;

      const form = new FormData();
      form.append("media", prepared);
      const result = await uploadGroupImageAction(form);
      setUploading(false);

      if (!result.ok || !result.mediaId) {
        setFeedback(result.message);
        return;
      }
      setImageMediaId(result.mediaId);
      setImagePreview(result.previewUrl ?? null);
    });
  }

  function createGroup() {
    startTransition(async () => {
      const result = await createGroupAction({
        name,
        description,
        imageMediaId: imageMediaId ?? undefined
      });
      setFeedback(result.message);
      if (!result.ok) return;

      setName("");
      setDescription("");
      setImageMediaId(null);
      setImagePreview(null);
      setCreateOpen(false);

      if (result.groupId) {
        openGroup(result.groupId);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className={cn("space-y-5", embedded ? "" : "mx-auto max-w-[1200px] md:pt-6")}>
      {!embedded ? <PageHeader title="Groups" /> : null}

      <header className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between md:pt-0">
        <div>
          {!embedded ? <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Groups</h1> : null}
          <p className="text-sm text-muted-foreground">
            Private group conversations. Create one, handle invitations, or open an existing Group.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)} data-tour-id={TOUR_TARGET_IDS.GROUPS_CREATE}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create Group
        </Button>
      </header>

      {feedback ? <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm" role="status">{feedback}</p> : null}

      <nav
        data-tour-id={TOUR_TARGET_IDS.GROUPS_TABS}
        className="overflow-x-auto border-b border-border/70"
        aria-label="Groups tabs"
      >
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

      {activeTab === "mine" ? (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your Groups"
            className="pl-9"
          />
        </div>
      ) : null}

      {activeTab === "requests" ? (
        data.invitations.length > 0 ? (
          <div data-tour-id={TOUR_TARGET_IDS.GROUPS_INVITES} className="space-y-3">
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
                    if (result.ok && accept && result.groupId) openGroup(result.groupId);
                  });
                }}
              />
            ))}
          </div>
        ) : (
          <div data-tour-id={TOUR_TARGET_IDS.GROUPS_INVITES}>
            <EmptyState
              icon={Inbox}
              className="!min-h-0 !shadow-none p-5"
              title="No Group invitations"
              description="Invitations from approved Muddies will appear here."
            />
          </div>
        )
      ) : visibleGroups.length > 0 ? (
        <div data-tour-id={TOUR_TARGET_IDS.GROUPS_LIST} className="grid gap-3 sm:grid-cols-2">
          {visibleGroups.map((group) => (
            <GroupCard key={group.id} group={group} onOpen={() => openGroup(group.id)} />
          ))}
        </div>
      ) : (
        <div data-tour-id={TOUR_TARGET_IDS.GROUPS_LIST}>
          <EmptyState
            icon={Users2}
            className="!min-h-0 !shadow-none p-5"
            title={query ? "No matching Groups" : "No Groups yet"}
            description={query ? "Try another search." : "Create a private Group or accept an invitation to get started."}
          />
        </div>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create Group"
        description="Groups are private and invite-only."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>Cancel</Button>
            <Button type="button" onClick={createGroup} disabled={isPending || uploading || name.trim().length < 2}>
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
            <Textarea id="group-description" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="What is this Group for?" />
          </FormField>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Group image (optional)</span>
            <label className="focus-ring flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 p-3 hover:bg-secondary/40">
              <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary/60">
                {imagePreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
                  <img src={imagePreview} alt="" className="h-full w-full object-cover" />
                ) : uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{imagePreview ? "Change image" : "Add an image"}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Shown as the Group photo in Messages.</span>
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading || isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) pickImage(file);
                }}
              />
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function GroupCard({ group, onOpen }: { group: GroupSummary; onOpen: () => void }) {
  return (
    <article className="flex min-h-[210px] flex-col rounded-2xl border border-border/80 bg-card/60 p-5">
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
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{group.description || "A private Mad Buddy Group."}</p>
      {group.lastMessagePreview ? <p className="mt-2 truncate text-xs text-muted-foreground">{group.lastMessagePreview}</p> : null}
      {group.lastMessageAt ? <p className="mt-1 text-[11px] text-muted-foreground">Active {formatRelativeTime(group.lastMessageAt)}</p> : null}
      <div className="mt-auto pt-4">
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onOpen}>Open group</Button>
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
