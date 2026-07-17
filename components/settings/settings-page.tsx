"use client";

import Link from "next/link";
import {
  Bell,
  Blocks,
  CalendarClock,
  ChevronRight,
  CreditCard,
  Database,
  Gauge,
  Ghost,
  Globe,
  HelpCircle,
  Laptop,
  MapPinOff,
  MessageSquare,
  Palette,
  PartyPopper,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Trophy,
  UserPlus,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  updateNotificationPreferenceAction,
  updateVisibilityStatusAction
} from "@/app/(app)/settings-actions";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { DeleteAccountModal } from "@/components/settings/delete-account-modal";
import { DataExportButton } from "@/components/settings/data-export-button";
import { LocationForGlowSetting } from "@/components/settings/location-for-glow-setting";
import type { VisibilityStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type SettingsPageContentProps = {
  initialVisibilityStatus?: VisibilityStatus;
  initialNearbyAlerts?: boolean;
};

export function SettingsPageContent({
  initialVisibilityStatus = "visible",
  initialNearbyAlerts = true
}: SettingsPageContentProps) {
  const [visibilityStatus, setVisibilityStatus] = useState<VisibilityStatus>(initialVisibilityStatus);
  const [nearbyAlerts, setNearbyAlerts] = useState(initialNearbyAlerts);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string, error = false) {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, error });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }

  function saveVisibility(nextStatus: VisibilityStatus) {
    const previousStatus = visibilityStatus;
    setVisibilityStatus(nextStatus);
    startTransition(async () => {
      const result = await updateVisibilityStatusAction(nextStatus);

      if (!result.ok) {
        setVisibilityStatus(previousStatus);
        showToast("Couldn’t update this setting. Try again.", true);
        return;
      }

      window.dispatchEvent(
        new CustomEvent("mad-buddy:location-sync-status", {
          detail: { enabled: nextStatus !== "ghost" }
        })
      );
      showToast("Settings updated");
    });
  }

  function saveNearbyAlerts(checked: boolean) {
    const previousValue = nearbyAlerts;
    setNearbyAlerts(checked);
    startTransition(async () => {
      const result = await updateNotificationPreferenceAction({ nearbyAlerts: checked });

      if (!result.ok) {
        setNearbyAlerts(previousValue);
        showToast("Couldn’t update this setting. Try again.", true);
        return;
      }

      showToast("Settings updated");
    });
  }

  return (
    <div className="mr-auto max-w-[980px] space-y-6 pt-6">
      <header className="flex items-start justify-between gap-4 border-b border-border/70 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage your account and app preferences.
          </p>
        </div>
        <Button type="button" variant="outline" size="icon" asChild>
          <Link href="/notifications" aria-label="Notifications" title="Notifications">
            <Bell className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </header>

      <div className="space-y-6">
        <SettingsSection title="Account">
          <SettingsLinkRow
            icon={UserRound}
            title="Profile"
            description="Manage how approved friends see you."
            href="/profile"
          />
          <SettingsLinkRow
            icon={ShieldCheck}
            title="Account Privacy"
            description="Control who can see you and message you."
            href="/settings/privacy"
          />
          <SettingsLinkRow
            icon={Laptop}
            title="Sessions"
            description="See where you're logged in."
            href="/settings/sessions"
          />
          <SettingsLinkRow
            icon={Trophy}
            title="Badges & Achievements"
            description="Celebrate your vibe and consistency."
            href="/badges"
          />
          <SettingsLinkRow
            icon={Gauge}
            title="Buddy Score"
            description="Your trust score that grows with good vibes."
            href="/buddy-score"
          />
        </SettingsSection>

        <SettingsSection title="Privacy & safety">
          <SettingsLinkRow
            icon={Sparkles}
            title="Glow & Visibility"
            description="Control who can see you and for how long."
            href="/settings/glow-visibility"
          />
          <SettingsLinkRow
            icon={PartyPopper}
            title="Hangout Mode"
            description="Let people know you're down to hang out right now."
            href="/hangout-mode"
          />
          <LocationForGlowSetting onFeedback={showToast} />
          <PrivacyToggle
            icon={Ghost}
            title="Ghost Mode"
            description="Pause your visibility until you turn it back on."
            checked={visibilityStatus === "ghost"}
            onCheckedChange={(checked) => saveVisibility(checked ? "ghost" : "visible")}
          />
          <PrivacyToggle
            icon={MapPinOff}
            title="Only while app is open"
            description="Update your nearby status only while Mad Buddy is open."
            checked={visibilityStatus === "app_open_only"}
            onCheckedChange={(checked) => saveVisibility(checked ? "app_open_only" : "visible")}
          />
          <SettingsLinkRow
            icon={Shield}
            title="Privacy Zones"
            description="Pause visibility automatically in selected places."
            href="/upgrade"
          />
          <SettingsLinkRow
            icon={Blocks}
            title="Blocked users"
            description="Review or unblock people."
            href="/friends"
          />
          <SettingsLinkRow
            icon={ShieldCheck}
            title="Privacy setup"
            description="Who can see your glow, and who can reach you."
            href="/settings/privacy-setup"
          />
          <SettingsLinkRow
            icon={ShieldCheck}
            title="Safe Arrival"
            description="Ask trusted Muddies to check you got there."
            href="/safe-arrival"
          />
          <SettingsLinkRow
            icon={ShieldCheck}
            title="Safety Center"
            description="Tools and tips to keep you safe."
            href="/safety-center"
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <PrivacyToggle
            icon={Bell}
            title="Nearby alerts"
            description="Get notified when approved friends are nearby."
            checked={nearbyAlerts}
            onCheckedChange={saveNearbyAlerts}
          />
          <SettingsLinkRow
            icon={Bell}
            title="Notification preferences"
            description="Categories, quiet hours, and how you're reached."
            href="/settings/notifications"
          />
          <SettingsLinkRow
            icon={CalendarClock}
            title="Reminders"
            description="Plan reminders and notification preferences."
            href="/reminders"
          />
        </SettingsSection>

        <SettingsSection title="Preferences">
          <SettingsLinkRow
            icon={Palette}
            title="Appearance"
            description="Theme and accent color."
            href="/settings/appearance"
          />
          <SettingsLinkRow
            icon={Globe}
            title="Language & Region"
            description="Language, time zone, and formats."
            href="/settings/language"
          />
        </SettingsSection>

        <SettingsSection title="Billing">
          <SettingsLinkRow
            icon={CreditCard}
            title="Plan and billing"
            description="View your plan, invoices, and subscription options."
            href="/billing"
          />
        </SettingsSection>

        <SettingsSection title="Data">
          <DataExportButton />
          <SettingsLinkRow
            icon={Database}
            title="Data & Storage"
            description="Manage storage, exports, and cookies."
            href="/settings/data-storage"
          />
        </SettingsSection>

        <SettingsSection title="Support & feedback">
          <SettingsLinkRow
            icon={HelpCircle}
            title="Help & Support"
            description="Browse help topics or contact us."
            href="/help"
          />
          <SettingsLinkRow
            icon={MessageSquare}
            title="Send feedback"
            description="Rate Mad Buddy or suggest an idea."
            href="/settings/feedback"
          />
          <SettingsLinkRow
            icon={UserPlus}
            title="Invite Buddies"
            description="Invite friends and track your invites."
            href="/invite"
          />
        </SettingsSection>

        <section>
          <h2 className="text-base font-semibold text-red-700 dark:text-red-200">Danger zone</h2>
          <div className="mt-3 flex min-h-[4.25rem] flex-col gap-3 border-y border-red-300/25 px-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-red-800 dark:text-red-50">Delete account</p>
              <p className="mt-1 text-xs text-red-800/80 dark:text-red-50/80">Permanently delete your account and data.</p>
            </div>
            <Button type="button" variant="danger" size="sm" onClick={() => setDeleteOpen(true)} aria-label="Delete account" title="Delete account">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete account
            </Button>
          </div>
        </section>
      </div>

      <DeleteAccountModal open={deleteOpen} onOpenChange={setDeleteOpen} />

      {toast ? (
        <div
          role="status"
          className={cn(
            "fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg md:bottom-6",
            toast.error
              ? "border-red-300/30 bg-red-950 text-red-50"
              : "border-border bg-foreground text-background"
          )}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

type SettingsLinkRowProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  href:
    | "/profile"
    | "/upgrade"
    | "/billing"
    | "/friends"
    | "/settings/privacy"
    | "/settings/glow-visibility"
    | "/settings/notifications"
    | "/settings/privacy-setup"
    | "/hangout-mode"
    | "/badges"
    | "/buddy-score"
    | "/reminders"
    | "/settings/sessions"
    | "/settings/appearance"
    | "/settings/language"
    | "/settings/data-storage"
    | "/settings/feedback"
    | "/help"
    | "/invite"
    | "/safe-arrival"
    | "/safety-center";
};

function SettingsLinkRow({ icon: Icon, title, description, href }: SettingsLinkRowProps) {
  return (
    <Link
      href={href}
      className="focus-ring safe-motion flex min-h-[4.25rem] items-center justify-between gap-4 px-2 py-3 hover:bg-secondary/40"
      aria-label={title}
      title={title}
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
