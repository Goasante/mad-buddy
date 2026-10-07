"use client";

import { Link } from "@/lib/platform";
import type { Route } from "next";
import {
  Bell,
  BadgeCheck,
  BookOpen,
  ChevronRight,
  Gauge,
  HelpCircle,
  Info,
  Laptop,
  MessageSquare,
  Palette,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Trophy,
  UserPlus,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
/* NO Server Action imports: this renders in the native app too, and a
   "use server" import drags next/headers, lib/supabase/server and the
   service-role client into the mobile bundle -- the PR #84 failure. Both
   writes arrive through `client`, which each platform supplies. */
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";
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
 * Context rather than a prop on every row: the answer is the same for every
 * row, and threading it by hand invites the one row someone forgets — which is
 * precisely how a dead-end link ships.
 *
 * Web provides nothing and every row stays a link, because every destination
 * here exists on web.
 */
const DestinationAvailability = createContext<((href: string) => boolean) | null>(null);

type SettingsPageContentProps = {
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
   * Android passes isBuiltForMobile so web-only destinations render as
   * unavailable rather than falling through to the native SPA catch-all.
   * Left alone, every one rendered as a tappable row that reached the SPA
   * catch-all. They now render dimmed and non-navigating, with the reason in
   * the accessible name.
   *
   * Web passes nothing, because every destination here exists on web.
   */
  isDestinationAvailable?: (href: string) => boolean;
};

export function SettingsPageContent({
  header = null,
  renderDeleteAccountModal,
  footer = null,
  isDestinationAvailable
}: SettingsPageContentProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);

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
            title="Mad Buddy Access"
            description="See your access and what stays free."
            href="/settings/access"
          />
          <SettingsLinkRow
            icon={Laptop}
            title="Sessions"
            description="See where you're logged in."
            href="/settings/sessions"
          />
          <SettingsLinkRow
            icon={BadgeCheck}
            title="Account verification"
            description="Apply for and track identity verification."
            href="/settings/verification"
          />
          <SettingsLinkRow
            icon={ShieldAlert}
            title="Account status"
            description="Review restrictions and submit an appeal."
            href="/settings/account-status"
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
            icon={ShieldCheck}
            title="Account Privacy"
            description="Glow visibility, messaging privacy, contact discovery and blocked users."
            href="/settings/privacy"
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
          <SettingsLinkRow
            icon={Bell}
            title="Notification preferences"
            description="Categories, quiet hours, push, and how you're reached."
            href="/settings/notifications"
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
          <SettingsLinkRow
            icon={Info}
            title="About Mad Buddy"
            description="What the app does and how it keeps you in control."
            href="/settings/about"
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

    </div>
    </DestinationAvailability.Provider>
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
    | "/settings/about"
    | "/profile"
    | "/friends"
    | "/settings/access"
    | "/settings/privacy"
    | "/settings/glow-visibility"
    | "/settings/notifications"
    | "/settings/privacy-setup"
    | "/settings/engagement"
    | "/settings/communication"
    | "/badges"
    | "/buddy-score"
    | "/settings/sessions"
    | "/settings/verification"
    | "/settings/account-status"
    | "/settings/appearance"
    | "/settings/feedback"
    | "/settings/walkthrough"
    | "/help"
    | "/invite"
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
      href={href as Route}
      className="focus-ring safe-motion flex min-h-[4.25rem] items-center justify-between gap-4 px-2 py-3 hover:bg-secondary/40"
      aria-label={title}
      title={title}
    >
      {body}
    </Link>
  );
}
