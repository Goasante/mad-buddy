"use client";

import { BellOff, Bookmark, ChevronRight, Clock3, Pin, Search, ShieldCheck, Star, UsersRound } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useState } from "react";

import {
  updateConversationChatSettingsAction,
  updateConversationUserPreferencesAction
} from "@/app/(app)/messaging-ultimate-actions";
import { ChatCollectionsV4 } from "@/components/messaging/chat-collections-v4";
import { Modal } from "@/components/ui/modal";
import type { ConversationView } from "@/lib/messaging/mobile";
import type { CachedConversationControls } from "@/lib/messaging/thread-cache";
import { runOptimisticControlMutation } from "@/lib/messaging/optimistic-control";
import { cn } from "@/lib/utils";

type ViewerRole = "owner" | "admin" | "moderator" | "member" | null;
type CollectionTab = "saved" | "pinned";

const LIFETIMES = [
  { seconds: null, label: "Forever" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 604800, label: "7 days" },
  { seconds: 2592000, label: "30 days" }
] as const;

const CAPABILITY_OPTIONS = [
  { id: "all_members", label: "Everyone" },
  { id: "admins", label: "Admins" },
  { id: "owner", label: "Owner" },
  { id: "disabled", label: "Nobody" }
] as const;

export function ChatSettingsV4({
  open,
  onOpenChange,
  conversation,
  controls,
  pinsCount,
  viewerRole,
  onFavorite,
  onMute,
  onControlPatch,
  onSearch,
  onGroupDetails,
  onFeedback
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationView;
  controls: CachedConversationControls | null;
  pinsCount: number | null;
  viewerRole: ViewerRole;
  onFavorite: () => void;
  onMute: (hours: number) => Promise<{ ok: boolean; message: string }>;
  onControlPatch: (patch: {
    settings?: Partial<CachedConversationControls["settings"]>;
    preferences?: Partial<CachedConversationControls["preferences"]>;
  }) => void;
  onSearch: () => void;
  onGroupDetails: () => void;
  onFeedback: (message: string) => void;
}) {
  const [pendingControls, setPendingControls] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<"notifications" | "lifetime" | "group" | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("saved");
  const isGroup = conversation.kind === "group";
  const canManageGroup = viewerRole === "owner" || viewerRole === "admin";
  const settings = controls?.settings;
  const prefs = controls?.preferences;

  async function run(
    key: string,
    task: () => Promise<{ ok: boolean; message: string }>,
    optimistic?: () => void,
    rollback?: () => void
  ) {
    if (pendingControls.has(key)) return;
    setPendingControls((current) => new Set(current).add(key));
    const result = await runOptimisticControlMutation({ optimistic, rollback, mutation: task });
    onFeedback(result.message);
    setPendingControls((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function setLifetime(messageLifetimeSeconds: number | null) {
    if (!settings) return;
    const previous = settings.messageLifetimeSeconds;
    void run(
      "messageLifetimeSeconds",
      () => updateConversationChatSettingsAction({ conversationId: conversation.id, messageLifetimeSeconds }),
      () => onControlPatch({ settings: { messageLifetimeSeconds } }),
      () => onControlPatch({ settings: { messageLifetimeSeconds: previous } })
    );
  }

  function setPreference<K extends "notifyMentionsWhenMuted" | "notifyRepliesWhenMuted" | "notificationPreview">(
    key: K,
    value: CachedConversationControls["preferences"][K]
  ) {
    if (!prefs) return;
    const previous = prefs[key];
    void run(
      key,
      () => updateConversationUserPreferencesAction({ conversationId: conversation.id, [key]: value }),
      () => onControlPatch({ preferences: { [key]: value } }),
      () => onControlPatch({ preferences: { [key]: previous } })
    );
  }

  function setChatSetting<K extends "defaultMediaMode" | "whoCanPin" | "whoCanCreatePolls" | "whoCanUseEveryone" | "whoCanAddMembers">(
    key: K,
    value: CachedConversationControls["settings"][K]
  ) {
    if (!settings) return;
    const previous = settings[key];
    void run(
      key,
      () => updateConversationChatSettingsAction({ conversationId: conversation.id, [key]: value }),
      () => onControlPatch({ settings: { [key]: value } }),
      () => onControlPatch({ settings: { [key]: previous } })
    );
  }

  function openCollection(tab: CollectionTab) {
    setCollectionTab(tab);
    setCollectionsOpen(true);
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={isGroup ? "Group Settings" : "Chat Settings"}
        variant="sheet"
      >
        <div className="space-y-4 pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3 rounded-[22px] border border-border/60 bg-card/70 p-3">
            <UserAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" decorative className="border-2 border-background shadow-[inset_0_0_0_1px_hsl(var(--border)),0_8px_24px_hsl(var(--shadow)/0.16)]" />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm font-semibold">{conversation.title}</strong>
              <span className="text-xs text-muted-foreground">{isGroup ? "Group conversation" : conversation.otherUsername ? `@${conversation.otherUsername}` : "Conversation"}</span>
            </div>
          </div>

          <section className="overflow-hidden rounded-[22px] border border-border/60 bg-card/60">
            <SettingRow icon={BellOff} title={conversation.muted ? "Notifications muted" : "Mute notifications"} subtitle={conversation.muted ? "Choose Unmute below to receive everything again" : "Choose how long this chat should stay quiet"} onClick={() => setExpanded(expanded === "notifications" ? null : "notifications")} />
            {expanded === "notifications" ? (
              <div className="border-t border-border/50 px-3 py-3 animate-in slide-in-from-top-1 fade-in">
                <div className="flex flex-wrap gap-2">
                  {[{h:1,l:"1 hour"},{h:8,l:"8 hours"},{h:24,l:"Today"},{h:168,l:"1 week"},{h:87600,l:"Indefinitely"},{h:0,l:"Unmute"}].map((item) => (
                    <button key={item.l} type="button" disabled={pendingControls.has("mute")} onClick={() => void run("mute", () => onMute(item.h))} className="focus-ring min-h-10 rounded-full border border-border/70 px-3 text-xs font-semibold transition hover:border-primary/45 hover:bg-primary/8 active:scale-95 disabled:opacity-50">{item.l}</button>
                  ))}
                </div>
                {prefs ? (
                  <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                    <ToggleRow label="Still notify me for @mentions" checked={prefs.notifyMentionsWhenMuted} disabled={pendingControls.has("notifyMentionsWhenMuted")} onChange={(checked) => setPreference("notifyMentionsWhenMuted", checked)} />
                    <ToggleRow label="Still notify me for direct replies" checked={prefs.notifyRepliesWhenMuted} disabled={pendingControls.has("notifyRepliesWhenMuted")} onChange={(checked) => setPreference("notifyRepliesWhenMuted", checked)} />
                    <p className="pt-1 text-xs font-medium text-muted-foreground">Notification preview</p>
                    <Segmented disabled={pendingControls.has("notificationPreview")} value={prefs.notificationPreview} options={[{id:"always",label:"Always"},{id:"when_unlocked",label:"Unlocked"},{id:"never",label:"Never"}]} onChange={(value) => setPreference("notificationPreview", value)} />
                  </div>
                ) : <RowSkeleton label="Syncing notification preferences" />}
              </div>
            ) : null}

            <SettingRow icon={Star} title={conversation.pinned ? "Favorite chat" : "Add to favorites"} subtitle="Keep important chats easy to reach" onClick={onFavorite} active={conversation.pinned} />
            <SettingRow icon={Search} title="Search in chat" subtitle="Find messages and jump between results" onClick={onSearch} />
            <SettingRow icon={Bookmark} title="Saved messages" subtitle="Private messages and folders only you can see" onClick={() => openCollection("saved")} />
            <SettingRow icon={Pin} title="Pinned messages" subtitle={pinsCount === null ? "Open to view pinned messages" : pinsCount > 0 ? `${pinsCount} pinned in this chat` : "Shared navigation for important messages"} onClick={() => openCollection("pinned")} />

            <SettingRow icon={Clock3} title="Message lifetime" subtitle={settings ? LIFETIMES.find((item) => item.seconds === settings.messageLifetimeSeconds)?.label ?? "Forever" : "Syncing chat controls…"} onClick={() => setExpanded(expanded === "lifetime" ? null : "lifetime")} />
            {expanded === "lifetime" ? (
              <div className="border-t border-border/50 px-3 py-3 animate-in slide-in-from-top-1 fade-in">
                {settings ? <><p className="mb-2 text-xs leading-relaxed text-muted-foreground">New messages use this lifetime. Keeping a message in chat prevents its normal expiry.</p>
                <Segmented disabled={pendingControls.has("messageLifetimeSeconds")} value={String(settings.messageLifetimeSeconds ?? "forever")} options={LIFETIMES.map((item) => ({ id: String(item.seconds ?? "forever"), label: item.label }))} onChange={(value) => setLifetime(value === "forever" ? null : Number(value))} />
                <p className="mb-2 mt-4 text-xs font-semibold">Default media behaviour</p>
                <Segmented disabled={pendingControls.has("defaultMediaMode")} value={settings.defaultMediaMode === "24h" ? "24h" : "keep"} options={[{id:"keep",label:"Keep"},{id:"24h",label:"24h"}]} onChange={(value) => setChatSetting("defaultMediaMode", value)} />
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">View-once is intentionally not offered until Mad Buddy has a dedicated one-view authorization ledger. We do not label 24-hour media as view-once.</p></> : <RowSkeleton label="Syncing chat controls" />}
              </div>
            ) : null}

            {isGroup ? <SettingRow icon={UsersRound} title="Group details" subtitle="Members, roles and shared media" onClick={onGroupDetails} /> : null}
          </section>

          {isGroup && canManageGroup && settings ? (
            <section className="overflow-hidden rounded-[22px] border border-border/60 bg-card/60">
              <SettingRow icon={ShieldCheck} title="Group permissions" subtitle="Who can coordinate this conversation" onClick={() => setExpanded(expanded === "group" ? null : "group")} />
              {expanded === "group" ? (
                <div className="space-y-4 border-t border-border/50 px-3 py-4 animate-in slide-in-from-top-1 fade-in">
                  <PermissionRow disabled={pendingControls.has("whoCanPin")} label="Pin messages" value={settings.whoCanPin} onChange={(value) => setChatSetting("whoCanPin", value)} />
                  <PermissionRow disabled={pendingControls.has("whoCanCreatePolls")} label="Create polls" value={settings.whoCanCreatePolls} onChange={(value) => setChatSetting("whoCanCreatePolls", value)} />
                  <PermissionRow disabled={pendingControls.has("whoCanUseEveryone")} label="Use @everyone" value={settings.whoCanUseEveryone} onChange={(value) => setChatSetting("whoCanUseEveryone", value)} />
                  <PermissionRow disabled={pendingControls.has("whoCanAddMembers")} label="Add members" value={settings.whoCanAddMembers} onChange={(value) => setChatSetting("whoCanAddMembers", value)} />
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </Modal>

      <ChatCollectionsV4
        conversationId={conversation.id}
        open={collectionsOpen}
        onOpenChange={setCollectionsOpen}
        initialTab={collectionTab}
        onFeedback={onFeedback}
      />
    </>
  );
}

function SettingRow({ icon: Icon, title, subtitle, onClick, active }: { icon: typeof Search; title: string; subtitle: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring flex min-h-[67px] w-full items-center gap-3 border-b border-border/45 px-3 py-2.5 text-left last:border-b-0 hover:bg-black/[0.025] active:bg-black/[0.045] dark:hover:bg-white/[0.035]">
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", active ? "bg-primary text-white" : "bg-primary/10 text-primary")}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{title}</strong><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{subtitle}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4 text-xs font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => <button key={option.id} type="button" disabled={disabled} onClick={() => onChange(option.id)} className={cn("focus-ring min-h-9 rounded-full border px-3 text-xs font-medium transition active:scale-95 disabled:opacity-50", value === option.id ? "border-primary bg-primary text-white" : "border-border/70 bg-card")}>{option.label}</button>)}
    </div>
  );
}

function PermissionRow({ label, value, onChange, disabled }: { label: string; value: "all_members" | "admins" | "owner" | "disabled"; onChange: (value: "all_members" | "admins" | "owner" | "disabled") => void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold">{label}</p>
      <Segmented value={value} options={CAPABILITY_OPTIONS} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function RowSkeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="space-y-2 py-1"><div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" /><div className="h-9 w-full animate-pulse rounded-full bg-muted/70" /></div>;
}
