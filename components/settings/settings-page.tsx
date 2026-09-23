"use client";

import { Link } from "@/lib/platform";
import {
  Bell,
  Blocks,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Database,
  Download,
  Gauge,
  Ghost,
  Globe,
  HelpCircle,
  Info,
  Laptop,
  MapPinOff,
  MessageSquare,
  Palette,
  PartyPopper,
  ShieldCheck,
  RadioTower,
  Trash2,
  Trophy,
  UserPlus,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
/* NO Server Action imports: this renders in the native app too, and a
   "use server" import drags next/headers, lib/supabase/server and the
   service-role client into the mobile bundle -- the PR #84 failure. Both
   writes arrive through `client`, which each platform supplies. */
import type { SettingsClient } from "@/lib/settings/client";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
import { PrivacyToggle } from "@/components/settings/privacy-toggle";
import { DataExportButton } from "@/components/settings/data-export-button";
import { LocationForGlowSetting } from "@/components/settings/location-for-glow-setting";
import type { VisibilityStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
/* PageHeader is NOT imported: it reaches next/link and next/navigation through
   MobilePageHeader, and the native app has no App Router for useRouter() to
   attach to -- it throws on render. Web passes it in through `header`. */

/* The delete modal is INJECTED, not imported. delete-account-modal imports
   deleteAccountAction, and a lazy() import is still an import: the module stays
   in the graph and the "use server" chunk would be built for the native bundle
   too. Deleting an account is also genuinely platform-specific -- Android must
   clear its push token first, or a deleted user's device keeps receiving
   notifications. So each platform supplies its own. */

/**
 * Whether a destination exists on the platform rendering this screen.
 *
 * Context rather than a prop on all 24 rows: the answer is the same for every
 * row, and threading it by hand invites the one row someone forgets — which is
 * precisely how a dead-end link ships.
 *
 * Web provides nothing and every row stays a link, because every destination
 * here exists on web.
 */
const DestinationAvailability = createContext<((href: string) => boolean) | null>(null);

type SettingsPageContentProps = {
  initialVisibilityStatus?: VisibilityStatus;
  initialNearbyAlerts?: boolean;
  /**
   * How this screen reaches the server.
   *
   * Injected rather than calling Server Actions directly, so the same
   * component serves both apps: a "use server" import would drag
   * next/headers, lib/supabase/server and the service-role client into the
   * mobile bundle — the PR #84 failure. Both platforms end up in
   * lib/settings/service.ts regardless.
   */
  client: SettingsClient;
  /**
   * The page header, supplied by the platform.
   *
   * Web passes <PageHeader title="Settings" />. Android passes nothing: its
   * shell already renders a fixed AppHeader, and PageHeader reaches
   * next/navigation, where useRouter() has no App Router and throws on render.
   */
  header?: ReactNode;
  /**
   * The delete-account flow, which is platform-specific twice over: the web
   * modal imports a Server Action, and Android must remove this device's push
   * token before the account goes, or a deleted user's phone keeps receiving
   * notifications. Omitted entirely, the row still renders but opens nothing.
   */
  renderDeleteAccountModal?: (props: { open: boolean; onOpenChange: (open: boolean) => void }) => ReactNode;
  /**
   * Extra rows appended after the shared sections.
   *
   * Android puts Sign out and its two-step account deletion here. Both stores
   * require in-app deletion for apps that create accounts, and the native flow
   * differs from web's: it signs out afterwards so the device's push token is
   * unregistered rather than left pointing at a deleted user. Web appends
   * nothing — it deletes through the modal above and signs out from the
   * account menu.
   */
  footer?: ReactNode;
  /**
   * Whether a linked destination exists on this platform.
   *
   * Android passes isBuiltForMobile: 17 of the 24 destinations here are
   * unreachable — 13 settings-related web features with no native screen,
   * /about, and the pre-existing /hangout-mode, /badges and /safety-center.
   * Left alone, every one rendered as a tappable row that reached the SPA
   * catch-all. They now render dimmed and non-navigating, with the reason in
   * the accessible name.
   *
   * Web passes nothing, because every destination here exists on web.
   */
  isDestinationAvailable?: (href: string) => boolean;
};

export function SettingsPageContent({
  initialVisibilityStatus = "visible",
  initialNearbyAlerts = true,
  client,
  header = null,
  renderDeleteAccountModal,
  footer = null,
  isDestinationAvailable
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
      const result = await client.setVisibilityStatus(nextStatus);

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
      const result = await client.setNearbyAlerts(checked);

      if (!result.ok) {
        setNearbyAlerts(previousValue);
        showToast("Couldn’t update this setting. Try again.", true);
        return;
      }

      showToast("Settings updated");
    });
  }

  return (
    <DestinationAvailability.Provider value={isDestinationAvailable ?? null}>
    <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_OVERVIEW} className="mr-auto max-w-[980px] space-y-6 md:pt-6">
      {header}

      {/* The divider goes with the desktop title: on mobile the shared
          header draws its own once content scrolls under it. */}
      <header className="pt-1 md:border-b md:border-border/70 md:pb-4 md:pt-0">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block sm:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your account and app preferences.
        </p>
      </header>

      <div className="space-y-6">
        <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_ACCOUNT}>
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
            icon={ShieldCheck}
            title="Mad Buddy Access"
            description="Linkr and UpFor. See your access and what stays free."
            href="/settings/access"
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
        </div>

        <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_PRIVACY}>
        <SettingsSection title="Privacy & safety">
          <SettingsLinkRow
            /* Same concept, same glyph as the Glow settings page itself and
               the public pages: Glow is proximity presence being broadcast, so
               a signal mark rather than a sparkle. */
            icon={RadioTower}
            title="Glow & Visibility"
            description="Control who can see you and for how long."
            href="/settings/glow-visibility"
          />
          <SettingsLinkRow
            icon={PartyPopper}
            title="UpFor"
            description="Let people know you're down to hang out right now."
            href="/hangout-mode"
          />
          <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_LOCATION_GLOW}>
            <LocationForGlowSetting onFeedback={showToast} onEnable={client.enableLocationForGlow} />
          </div>
          <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_GHOST_MODE}>
            <PrivacyToggle
              icon={Ghost}
              title="Ghost Mode"
              description="Pause your visibility until you turn it back on."
              checked={visibilityStatus === "ghost"}
              onCheckedChange={(checked) => saveVisibility(checked ? "ghost" : "visible")}
            />
          </div>
          <PrivacyToggle
            icon={MapPinOff}
            title="Only while app is open"
            description="Update your nearby status only while Mad Buddy is open."
            checked={visibilityStatus === "app_open_only"}
            onCheckedChange={(checked) => saveVisibility(checked ? "app_open_only" : "visible")}
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
        </div>

        <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_NOTIFICATIONS}>
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
            title="Focus & balance"
            description="Focus Mode, notification limits, recaps and milestones."
            href="/settings/engagement"
          />
          <SettingsLinkRow
            icon={Bell}
            title="Notification preferences"
            description="Categories, quiet hours, and how you're reached."
            href="/settings/notifications"
          />
          <SettingsLinkRow
            icon={MessageSquare}
            title="Messaging privacy"
            description="Who can message you, Group adds, read receipts, previews."
            href="/settings/communication"
          />
          <SettingsLinkRow
            icon={CalendarClock}
            title="Reminders"
            description="Plan reminders and notification preferences."
            href="/reminders"
          />
        </SettingsSection>
        </div>

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


        <SettingsSection title="Data">
          {/* Export needs BOTH a working request and a way to deliver a file.
              Android has neither: the route is cookie-only, and <a download>
              does nothing in a WebView. A platform that cannot do it renders
              the row as unavailable rather than as a button that appears to
              work and silently delivers nothing. */}
          {client.exportAccountData ? (
            <DataExportButton onExport={client.exportAccountData} />
          ) : (
            <UnavailableRow icon={Download} title="Export your data" />
          )}
          <SettingsLinkRow
            icon={Database}
            title="Data & Storage"
            description="Manage storage, exports, and cookies."
            href="/settings/data-storage"
          />
        </SettingsSection>

        <div data-tour-id={TOUR_TARGET_IDS.SETTINGS_SUPPORT}>
        <SettingsSection title="Support & feedback">
          <SettingsLinkRow
            icon={HelpCircle}
            title="Help & Support"
            description="Browse help topics or contact us."
            href="/help"
          />
          <SettingsLinkRow
            /* Guides are documentation -- something to read. A book says
               that; a sparkle implied the guides were themselves some kind of
               magic feature. */
            icon={BookOpen}
            title="Feature guides"
            description="Learn or replay any Mad Buddy feature."
            href="/settings/walkthrough"
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
          {/* Moved here from Profile (MB-GOD-013). Settings already indexed every
              other destination Profile's Support block linked to; /about was the
              one exception, so it is added HERE FIRST — removing the Profile
              block before this row existed would have left version and legal
              information unreachable from inside the app. */}
          <SettingsLinkRow
            icon={Info}
            title="About Mad Buddy"
            description="Version, credits, and legal."
            href="/about"
          />
        </SettingsSection>
        </div>

        {/* SUPPRESSED WHEN NO MODAL IS INJECTED.
            The button only sets `deleteOpen`, so without a modal it does
            nothing at all -- a dead control sitting directly above Android's
            working native deletion section, which is both broken and a
            duplicate. A platform that supplies no modal renders no Danger
            zone; Android deletes through its footer instead. */}
        {renderDeleteAccountModal ? (
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
        ) : null}
      </div>

      {footer}

      {renderDeleteAccountModal?.({ open: deleteOpen, onOpenChange: setDeleteOpen }) ?? null}

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
    </DestinationAvailability.Provider>
  );
}

/**
 * A control this platform cannot offer, shown rather than hidden.
 *
 * Same treatment as a link to a route that does not exist: a real disabled
 * button, dimmed, with the reason in the accessible name. Hiding it would make
 * the two platforms look more different than they are; leaving it live would be
 * a control that appears to work and does nothing.
 */
function UnavailableRow({
  icon: Icon,
  title
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      aria-label={`${title}. Not in the Android app yet.`}
      title={`${title}. Not in the Android app yet.`}
      className="flex min-h-[4.25rem] w-full cursor-default items-center justify-between gap-4 px-2 py-3 text-left opacity-55"
    >
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Not in the Android app yet.</p>
        </div>
      </div>
    </button>
  );
}

type SettingsLinkRowProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /* An explicit allow-list rather than `Route`: it catches a typo or a link to
     a route that no longer exists at compile time, which is worth more here
     than the convenience of accepting any string. Extend it deliberately. */
  href:
    | "/about"
    | "/profile"
    | "/friends"
    | "/settings/access"
    | "/settings/privacy"
    | "/settings/glow-visibility"
    | "/settings/notifications"
    | "/settings/privacy-setup"
    | "/settings/engagement"
    | "/settings/communication"
    | "/hangout-mode"
    | "/badges"
    | "/buddy-score"
    | "/reminders"
    | "/settings/sessions"
    | "/settings/appearance"
    | "/settings/language"
    | "/settings/data-storage"
    | "/settings/feedback"
    | "/settings/walkthrough"
    | "/help"
    | "/invite"
    | "/safe-arrival"
    | "/safety-center";
};

function SettingsLinkRow({ icon: Icon, title, description, href }: SettingsLinkRowProps) {
  const isAvailable = useContext(DestinationAvailability);
  const unavailable = isAvailable ? !isAvailable(href) : false;
  const body = (
    <>
      <div className="flex gap-3">
        <Icon
          className={cn("mt-0.5 h-5 w-5 shrink-0", unavailable ? "text-muted-foreground" : "text-accent")}
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {unavailable ? "Not in the Android app yet." : description}
          </p>
        </div>
      </div>
      {unavailable ? null : (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );

  /* A REAL BUTTON, not a dimmed Link. `aria-disabled` on an anchor still lets
     it be followed -- the row would look unavailable and navigate anyway, to
     the SPA catch-all. The same reasoning as the disabled bottom-nav tabs.

     The reason goes in the accessible name because the visual dimming alone
     says nothing to a screen reader. */
  if (unavailable) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label={`${title}. Not in the Android app yet.`}
        title={`${title}. Not in the Android app yet.`}
        className="flex min-h-[4.25rem] w-full cursor-default items-center justify-between gap-4 px-2 py-3 text-left opacity-55"
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="focus-ring safe-motion flex min-h-[4.25rem] items-center justify-between gap-4 px-2 py-3 hover:bg-secondary/40"
      aria-label={title}
      title={title}
    >
      {body}
    </Link>
  );
}
