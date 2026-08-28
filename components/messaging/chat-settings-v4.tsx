"use client";

import { BellOff, Bookmark, ChevronRight, Clock3, Image, Pin, Search, ShieldCheck, Star, UsersRound } from "lucide-react";
import { useState, useTransition } from "react";

import { muteConversationAction } from "@/app/(app)/messaging-actions";
import {
  updateConversationChatSettingsAction,
  updateConversationUserPreferencesAction
} from "@/app/(app)/messaging-ultimate-actions";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { ChatCollectionsV4 } from "@/components/messaging/chat-collections-v4";
import { Modal } from "@/components/ui/modal";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import type { ConversationView } from "@/lib/messaging/mobile";
import type { UltimateConversationState } from "@/lib/messaging/ultimate-types";
import { cn } from "@/lib/utils";

type ViewerRole = "owner" | "admin" | "moderator" | "member" | null;
type CollectionTab = "saved" | "pinned";

const THEMES = [
  { id: "default", label: "Paper", preview: "linear-gradient(145deg,#fffdfc,#f8eee3)" },
  { id: "apricot", label: "Apricot", preview: "linear-gradient(145deg,#fff4e5,#f5c18a)" },
  { id: "maroon", label: "Maroon", preview: "linear-gradient(145deg,#4E0401,#9b493e)" },
  { id: "sunset", label: "Sunset", preview: "linear-gradient(145deg,#f5a85a,#d96655)" },
  { id: "forest", label: "Forest", preview: "linear-gradient(145deg,#264d3a,#8da78c)" }
] as const;

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
  ultimate,
  viewerRole,
  onFavorite,
  onSearch,
  onGroupDetails,
  onRefresh,
  onFeedback
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationView;
  ultimate: UltimateConversationState | null;
  viewerRole: ViewerRole;
  onFavorite: () => void;
  onSearch: () => void;
  onGroupDetails: () => void;
  onRefresh: () => void | Promise<void>;
  onFeedback: (message: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<"notifications" | "theme" | "lifetime" | "group" | null>(null);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("saved");
  const isGroup = conversation.kind === "group";
  const canManageGroup = viewerRole === "owner" || viewerRole === "admin";
  const settings = ultimate?.settings;
  const prefs = ultimate?.preferences;

  function run(task: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const result = await task();
      onFeedback(result.message);
      if (result.ok) await onRefresh();
    });
  }

  function setTheme(themeKey: string) {
    run(() => updateConversationUserPreferencesAction({ conversationId: conversation.id, themeKey }));
  }

  function setLifetime(messageLifetimeSeconds: number | null) {
    run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, messageLifetimeSeconds }));
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
            <GlowAvatar name={conversation.title} src={conversation.avatarUrl} size="sm" membershipTier={publicMembershipTier(conversation.otherPlan)} />
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-[15px]">{conversation.title}</strong>
              <span className="text-xs text-muted-foreground">{isGroup ? "Group conversation" : conversation.otherUsername ? `@${conversation.otherUsername}` : "Conversation"}</span>
            </div>
          </div>

          <section className="overflow-hidden rounded-[22px] border border-border/60 bg-card/60">
            <SettingRow icon={BellOff} title={conversation.muted ? "Notifications muted" : "Mute notifications"} subtitle={conversation.muted ? "Choose Unmute below to receive everything again" : "Choose how long this chat should stay quiet"} onClick={() => setExpanded(expanded === "notifications" ? null : "notifications")} />
            {expanded === "notifications" ? (
              <div className="border-t border-border/50 px-3 py-3 animate-in slide-in-from-top-1 fade-in">
                <div className="flex flex-wrap gap-2">
                  {[{h:1,l:"1 hour"},{h:8,l:"8 hours"},{h:24,l:"Today"},{h:168,l:"1 week"},{h:87600,l:"Indefinitely"},{h:0,l:"Unmute"}].map((item) => (
                    <button key={item.l} type="button" disabled={isPending} onClick={() => run(() => muteConversationAction(conversation.id, item.h))} className="focus-ring min-h-10 rounded-full border border-border/70 px-3 text-xs font-semibold transition hover:border-[#E88C2B]/45 hover:bg-[#E88C2B]/8 active:scale-95">{item.l}</button>
                  ))}
                </div>
                {prefs ? (
                  <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
                    <ToggleRow label="Still notify me for @mentions" checked={prefs.notifyMentionsWhenMuted} disabled={isPending} onChange={(checked) => run(() => updateConversationUserPreferencesAction({ conversationId: conversation.id, notifyMentionsWhenMuted: checked }))} />
                    <ToggleRow label="Still notify me for direct replies" checked={prefs.notifyRepliesWhenMuted} disabled={isPending} onChange={(checked) => run(() => updateConversationUserPreferencesAction({ conversationId: conversation.id, notifyRepliesWhenMuted: checked }))} />
                    <p className="pt-1 text-[11px] font-semibold text-muted-foreground">Notification preview</p>
                    <Segmented value={prefs.notificationPreview} options={[{id:"always",label:"Always"},{id:"when_unlocked",label:"Unlocked"},{id:"never",label:"Never"}]} onChange={(value) => run(() => updateConversationUserPreferencesAction({ conversationId: conversation.id, notificationPreview: value }))} />
                  </div>
                ) : null}
              </div>
            ) : null}

            <SettingRow icon={Star} title={conversation.pinned ? "Favorite chat" : "Add to favorites"} subtitle="Keep important chats easy to reach" onClick={onFavorite} active={conversation.pinned} />
            <SettingRow icon={Search} title="Search in chat" subtitle="Find messages and jump between results" onClick={onSearch} />
            <SettingRow icon={Bookmark} title="Saved messages" subtitle="Private messages and folders only you can see" onClick={() => openCollection("saved")} />
            <SettingRow icon={Pin} title="Pinned messages" subtitle={ultimate?.pins.length ? `${ultimate.pins.length} pinned in this chat` : "Shared navigation for important messages"} onClick={() => openCollection("pinned")} />

            <SettingRow icon={Image} title="Conversation theme" subtitle={THEMES.find((theme) => theme.id === (prefs?.themeKey ?? "default"))?.label ?? "Paper"} onClick={() => setExpanded(expanded === "theme" ? null : "theme")} />
            {expanded === "theme" ? (
              <div className="border-t border-border/50 px-3 py-3 animate-in slide-in-from-top-1 fade-in">
                <div className="grid grid-cols-5 gap-2">
                  {THEMES.map((theme) => {
                    const active = (prefs?.themeKey ?? "default") === theme.id;
                    return (
                      <button key={theme.id} type="button" disabled={isPending} onClick={() => setTheme(theme.id)} className="focus-ring group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-[10px] font-semibold">
                        <span className={cn("block h-10 w-10 rounded-full border-2 shadow-sm transition-transform group-active:scale-90", active ? "border-[#E88C2B] scale-110" : "border-white dark:border-white/10")} style={{ background: theme.preview }} />
                        {theme.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <SettingRow icon={Clock3} title="Message lifetime" subtitle={LIFETIMES.find((item) => item.seconds === (settings?.messageLifetimeSeconds ?? null))?.label ?? "Forever"} onClick={() => setExpanded(expanded === "lifetime" ? null : "lifetime")} />
            {expanded === "lifetime" ? (
              <div className="border-t border-border/50 px-3 py-3 animate-in slide-in-from-top-1 fade-in">
                <p className="mb-2 text-xs leading-relaxed text-muted-foreground">New messages use this lifetime. Keeping a message in chat prevents its normal expiry.</p>
                <Segmented value={String(settings?.messageLifetimeSeconds ?? "forever")} options={LIFETIMES.map((item) => ({ id: String(item.seconds ?? "forever"), label: item.label }))} onChange={(value) => setLifetime(value === "forever" ? null : Number(value))} />
                <p className="mb-2 mt-4 text-xs font-semibold">Default photo behaviour</p>
                <Segmented value={settings?.defaultMediaMode ?? "keep"} options={[{id:"keep",label:"Keep"},{id:"view_once",label:"View once"},{id:"24h",label:"24h"}]} onChange={(value) => run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, defaultMediaMode: value }))} />
              </div>
            ) : null}

            {isGroup ? <SettingRow icon={UsersRound} title="Group details" subtitle="Members, roles and shared media" onClick={onGroupDetails} /> : null}
          </section>

          {isGroup && canManageGroup && settings ? (
            <section className="overflow-hidden rounded-[22px] border border-border/60 bg-card/60">
              <SettingRow icon={ShieldCheck} title="Group permissions" subtitle="Who can coordinate this conversation" onClick={() => setExpanded(expanded === "group" ? null : "group")} />
              {expanded === "group" ? (
                <div className="space-y-4 border-t border-border/50 px-3 py-4 animate-in slide-in-from-top-1 fade-in">
                  <PermissionRow label="Pin messages" value={settings.whoCanPin} onChange={(value) => run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, whoCanPin: value }))} />
                  <PermissionRow label="Create polls" value={settings.whoCanCreatePolls} onChange={(value) => run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, whoCanCreatePolls: value }))} />
                  <PermissionRow label="Use @everyone" value={settings.whoCanUseEveryone} onChange={(value) => run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, whoCanUseEveryone: value }))} />
                  <PermissionRow label="Add members" value={settings.whoCanAddMembers} onChange={(value) => run(() => updateConversationChatSettingsAction({ conversationId: conversation.id, whoCanAddMembers: value }))} />
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="rounded-[20px] border border-[#E88C2B]/16 bg-[#E88C2B]/7 p-3 text-[11px] leading-relaxed text-muted-foreground">
            Chats are protected by Mad Buddy's server authorization and transport encryption. End-to-end encryption is not shown here because it requires a separate cryptographic key architecture, not a cosmetic switch.
          </div>
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
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", active ? "bg-[#E88C2B] text-white" : "bg-[#E88C2B]/10 text-[#E88C2B]")}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{title}</strong><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{subtitle}</span></span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ToggleRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-4 text-xs font-medium">
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#E88C2B]" />
    </label>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => <button key={option.id} type="button" onClick={() => onChange(option.id)} className={cn("focus-ring min-h-9 rounded-full border px-3 text-[11px] font-semibold transition active:scale-95", value === option.id ? "border-[#E88C2B] bg-[#E88C2B] text-white" : "border-border/70 bg-card")}>{option.label}</button>)}
    </div>
  );
}

function PermissionRow({ label, value, onChange }: { label: string; value: "all_members" | "admins" | "owner" | "disabled"; onChange: (value: "all_members" | "admins" | "owner" | "disabled") => void }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold">{label}</p>
      <Segmented value={value} options={CAPABILITY_OPTIONS} onChange={onChange} />
    </div>
  );
}
