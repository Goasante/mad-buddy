"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import type { Route } from "next";
import {
  ChevronRight,
  Crown,
  HelpCircle,
  Info,
  LifeBuoy,
  LogOut,
  MapPin,
  Settings as SettingsIcon,
  ShieldCheck,
  ShieldPlus,
  Trophy,
  UserPlus,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSecureLogout } from "@/components/auth/use-secure-logout";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

type SheetRow = {
  href: Route;
  label: string;
  /** Says what the destination actually owns, so the label can stay short. */
  subtitle: string;
  icon: LucideIcon;
};

/**
 * ACCOUNT — who you are with Mad Buddy, and how you are doing.
 *
 * "Mad Buddy Access" is access, not social status: it points at
 * /settings/access, the screen that explains what Linkr and UpFor unlock and
 * what stays free. It deliberately does NOT point at /billing, which is
 * historical compatibility infrastructure rather than a consumer
 * destination, and it is never labelled Membership/Premium/Plus/Pro —
 * naming a tier turns access into a badge people wear.
 *
 * Progress leads to /buddy-score because that screen already carries the
 * Achievements section and its "View all" handoff into /badges. Both
 * canonical screens stay exactly as they are; no combined route is invented
 * to match the label.
 */
const ACCOUNT: SheetRow[] = [
  { href: "/settings/access", label: "Mad Buddy Access", subtitle: "Manage your access", icon: Crown },
  { href: "/buddy-score", label: "Progress & Achievements", subtitle: "Buddy Score & badges", icon: Trophy }
];

/** CONTROLS — everything that changes how the app behaves around you. */
const CONTROLS: SheetRow[] = [
  { href: "/settings", label: "Settings", subtitle: "Preferences & account", icon: SettingsIcon },
  { href: "/settings/privacy", label: "Privacy & Safety", subtitle: "Control your data & safety", icon: ShieldCheck },
  // Named for what it controls. The old "Location & Permissions" label
  // promised the OS permission screen and delivered Mad Buddy's own
  // visibility settings — two genuinely different concepts, and the wrong
  // one to imply when someone is looking for the system toggle.
  { href: "/settings/glow-visibility", label: "Glow & Visibility", subtitle: "Manage your presence", icon: MapPin }
];

/**
 * COMMUNITY & SUPPORT. "Buddies" is the word this hub uses for people, so
 * the invite row says Invite Buddies rather than Invite Friends.
 */
const COMMUNITY: SheetRow[] = [
  { href: "/invites", label: "Invite Buddies", subtitle: "Invite people you know", icon: UserPlus },
  { href: "/help", label: "Help & Support", subtitle: "Get help and contact us", icon: HelpCircle },
  { href: "/settings/feedback", label: "Send Feedback", subtitle: "Share your thoughts", icon: LifeBuoy },
  { href: "/about", label: "About Mad Buddy", subtitle: "Version, legal, and more", icon: Info }
];

/**
 * Owner/Admin only. Rendered from a SERVER-resolved flag (`showAdminLink`,
 * already computed by the authenticated layout from `getAdminContext()`), so
 * this is a visibility decision, never an authorization one — `/admin` and
 * every action beneath it re-check permission server-side regardless of what
 * this sheet chose to draw.
 */
const ADMINISTRATION: SheetRow[] = [
  { href: "/admin", label: "Administration", subtitle: "Admin tools", icon: ShieldPlus }
];

/**
 * The Account Hub — the app-wide menu, opened from every screen's hamburger.
 *
 * It has ONE job: fast access. It answers who am I, where is my access, how
 * am I progressing, where are my important controls, how do I get help, how
 * do I sign out — and then hands off. Anything deeper belongs on the
 * canonical destination screen, which is why /settings remains the full
 * control center and this list never grows into a second copy of it.
 *
 * One component, two presentations: a bottom sheet on phones, a compact
 * floating panel anchored top-right from `sm` up. The content and its order
 * are identical in both; only the frame changes.
 *
 * Reuses Modal's sheet CSS (modal-drop-overlay / menu-sheet-panel: slide-up,
 * safe-area padding, reduced-motion handling) directly via Radix Dialog
 * rather than through <Modal>, because this needs an identity header instead
 * of Modal's fixed title/close-X row.
 *
 * NO useDismissOnBack here — every row is a <Link>, and that hook's
 * Back-press cleanup calls history.back(), which cancels an in-flight App
 * Router navigation when the sheet closes as part of the same click. Rows
 * close via <Dialog.Close asChild> around the Link for the same reason: the
 * close is the click's own consequence, not a second history entry.
 */
export function HomeSettingsSheet({
  open,
  onOpenChange,
  displayName,
  currentUsername,
  currentAvatarUrl,
  showAdminLink = false
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  /**
   * Whether this account has staff access, resolved on the SERVER by the
   * authenticated layout. Defaults false, so a caller that forgets to pass it
   * hides the entry rather than exposing it.
   */
  showAdminLink?: boolean;
}) {
  const { logout, isPending: logoutPending } = useSecureLogout();
  const name = displayName || currentUsername || "Your account";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 z-[60] bg-black/50 backdrop-blur-md" />
        <Dialog.Content
          className={cn(
            "modal-sheet-panel menu-sheet-panel fixed z-[61] flex flex-col overflow-hidden bg-card outline-none",
            // Mobile: bottom sheet. The cap subtracts the top inset so a tall
            // sheet on a short screen still stops below the notch.
            "inset-x-0 bottom-0 max-h-[calc(90svh-env(safe-area-inset-top,0px))] w-full rounded-t-[1.875rem] border border-b-0 border-border/80 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)]",
            // Desktop/tablet: a compact panel anchored under the header on the
            // right, not a giant centred modal. Same content, different frame.
            "sm:inset-x-auto sm:bottom-auto sm:left-auto sm:right-4 sm:top-[calc(env(safe-area-inset-top,0px)+4rem)] sm:max-h-[calc(100svh-6rem)] sm:w-[24rem] sm:rounded-[1.5rem] sm:border sm:border-border/80 sm:pb-3 sm:shadow-[0_24px_70px_hsl(var(--shadow)/0.22)]"
          )}
        >
          <Dialog.Title className="sr-only">Account menu</Dialog.Title>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-1 pt-3.5 sm:px-4">
            {/* Identity — the ONE way into the profile from this menu. The
                whole row is the link, so there is no second "View my profile"
                entry below competing with it.

                No plan badge, no membership ring, no Glow: access is not a
                social status, and decorating identity with a tier is exactly
                the treatment this hub exists to remove. */}
            <Dialog.Close asChild>
              <Link
                href={"/profile" as Route}
                className="focus-ring safe-motion flex min-h-[56px] items-center gap-3 rounded-2xl px-2 py-2 pr-12 transition-colors hover:bg-secondary/50"
              >
                <UserAvatar src={currentAvatarUrl} name={name} size="sm" decorative className="h-12 w-12" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1.0625rem] font-semibold leading-tight">{name}</span>
                  <span className="mt-0.5 block truncate text-[0.8125rem] text-muted-foreground">View my profile</span>
                </span>
                <ChevronRight className="h-[1.125rem] w-[1.125rem] shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </Dialog.Close>

            {/* Grouping is carried by spacing and grouped cards rather than a
                stack of uppercase headings — the labels stay for screen
                readers, where the grouping is otherwise invisible. */}
            <SheetGroup rows={ACCOUNT} label="Account" className="mt-3" />
            <SheetGroup rows={CONTROLS} label="Controls" className="mt-2.5" />
            <SheetGroup rows={COMMUNITY} label="Community and support" className="mt-2.5" />
            {showAdminLink ? (
              <SheetGroup rows={ADMINISTRATION} label="Administration" className="mt-2.5" badge="Admin" />
            ) : null}

            {/* Sign out — isolated below the navigation, because it ends the
                session rather than going somewhere. */}
            <div className="mt-3 border-t border-border/60 pt-3">
              <button
                type="button"
                disabled={logoutPending}
                onClick={logout}
                className="account-hub-danger focus-ring safe-motion flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 transition-colors hover:bg-destructive/10 disabled:opacity-60"
              >
                <LogOut className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1 text-left text-[0.9375rem] font-semibold">Sign out</span>
              </button>
            </div>
          </div>

          {/* A real control, not a decorative affordance: the sheet is not
              draggable, so it carries no drag handle to suggest otherwise. */}
          <Dialog.Close
            aria-label="Close account menu"
            className="focus-ring safe-motion absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * One grouped card of rows. The heading is sr-only: the grouping reads
 * visually from the card boundaries and spacing, but a screen reader gets
 * nothing from a gap, so the name is announced rather than drawn.
 */
function SheetGroup({
  rows,
  label,
  className,
  badge
}: {
  rows: SheetRow[];
  label: string;
  className?: string;
  badge?: string;
}) {
  return (
    <section className={className} aria-label={label}>
      <div className="overflow-hidden rounded-2xl border border-border/70">
        {rows.map((row, index) => (
          <Dialog.Close asChild key={row.href}>
            <Link
              href={row.href}
              className={cn(
                "focus-ring safe-motion flex min-h-[56px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/40",
                index > 0 && "border-t border-border/60"
              )}
            >
              <row.icon
                className="h-[1.125rem] w-[1.125rem] shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-[0.9375rem] font-semibold leading-tight">{row.label}</span>
                  {badge ? (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-primary">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[0.75rem] leading-tight text-muted-foreground">
                  {row.subtitle}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </Dialog.Close>
        ))}
      </div>
    </section>
  );
}
