"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  Award,
  ChevronRight,
  Gauge,
  HelpCircle,
  Info,
  KeyRound,
  LogOut,
  MessageSquareText,
  RadioTower,
  Settings as SettingsIcon,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSecureLogout } from "@/components/auth/use-secure-logout";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type SheetRow = {
  href: Route;
  label: string;
  icon: LucideIcon;
  emphasis?: "normal" | "quiet";
};

type HomeSettingsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  /**
   * Kept in the A1 prop contract so AppShell does not need an unrelated data
   * plumbing rewrite. The account hub deliberately does not render old tier
   * identity, Buddy Score status, or profile-completion status. A2/A3 own any
   * decision to remove those server-resolved values from the shell entirely.
   */
  subscriptionPlan: SubscriptionPlan | null | undefined;
  buddyScoreLevelLabel: string | null;
  profileCompletionPercent: number;
  /** Server-resolved staff visibility. Authorization is still checked by /admin. */
  showAdminLink?: boolean;
};

const YOUR_MAD_BUDDY: SheetRow[] = [
  { href: "/settings/access", label: "Mad Buddy Access", icon: KeyRound },
  { href: "/buddy-score", label: "Progress", icon: TrendingUp },
  { href: "/badges", label: "Achievements", icon: Award }
];

const CONTROLS: SheetRow[] = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/settings/privacy", label: "Privacy & Safety", icon: ShieldCheck },
  { href: "/settings/glow-visibility", label: "Glow & Visibility", icon: RadioTower }
];

const CONNECT: SheetRow[] = [{ href: "/invite", label: "Invite Friends", icon: UserPlus }];

const SUPPORT: SheetRow[] = [
  { href: "/help", label: "Help & Support", icon: HelpCircle },
  { href: "/settings/feedback", label: "Send Feedback", icon: MessageSquareText },
  { href: "/about", label: "About Mad Buddy", icon: Info, emphasis: "quiet" }
];

const ADMINISTRATION: SheetRow[] = [{ href: "/admin", label: "Administration", icon: Gauge }];

/**
 * App-wide account hub. Mobile uses a bottom-anchored sheet; larger screens
 * use the same information architecture in a compact account panel.
 *
 * The hub is intentionally not a second Settings directory. It exposes the
 * common personal destinations and leaves the complete control surface to
 * /settings. Radix owns Escape, backdrop dismissal and focus restoration.
 * There is one internal scroll owner and no decorative drag affordance.
 */
export function HomeSettingsSheet({
  open,
  onOpenChange,
  displayName,
  currentUsername,
  currentAvatarUrl,
  showAdminLink = false
}: HomeSettingsSheetProps) {
  const { logout, isPending: logoutPending } = useSecureLogout();
  const initial = (displayName || currentUsername || "?").charAt(0).toUpperCase();
  const identityLabel = displayName || currentUsername || "Your account";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 z-[60] bg-black/45 sm:bg-black/25" />
        <Dialog.Content className="modal-sheet-panel menu-sheet-panel fixed inset-x-0 bottom-0 z-[61] flex max-h-[calc(92svh-env(safe-area-inset-top,0px))] w-full flex-col overflow-hidden rounded-t-[1.75rem] border border-b-0 border-border/75 bg-background shadow-[0_-18px_60px_hsl(var(--shadow)/0.24)] outline-none sm:inset-x-auto sm:bottom-auto sm:right-6 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:w-[25rem] sm:rounded-[1.5rem] sm:border">
          <Dialog.Title className="sr-only">Account hub</Dialog.Title>
          <Dialog.Description className="sr-only">
            Quick links to your profile, Mad Buddy controls, support, and account actions.
          </Dialog.Description>

          <Dialog.Close
            className="focus-ring safe-motion absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full text-[#4E0401] transition-colors hover:bg-secondary/60 dark:text-[#FEFBF3]"
            aria-label="Close account menu"
          >
            <X className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </Dialog.Close>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
            <Dialog.Close asChild>
              <Link
                href="/profile"
                aria-label={`View profile for ${identityLabel}`}
                className="focus-ring safe-motion group flex min-h-[76px] items-center gap-3 rounded-2xl px-1 pr-14 transition-colors hover:bg-secondary/35"
              >
                <UserAvatar
                  src={currentAvatarUrl}
                  name={initial}
                  size="sm"
                  decorative
                  className="h-12 w-12 shrink-0 border border-border/70"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[1.0625rem] font-semibold leading-tight text-foreground">
                    {identityLabel}
                  </p>
                  {currentUsername ? (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">@{currentUsername}</p>
                  ) : null}
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    View profile
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </span>
                </div>
              </Link>
            </Dialog.Close>

            <SheetGroup rows={YOUR_MAD_BUDDY} label="Your Mad Buddy" className="mt-4" />
            <SheetGroup rows={CONTROLS} label="Controls" className="mt-4" />
            <SheetGroup rows={CONNECT} label="Connect" className="mt-4" />
            <SheetGroup rows={SUPPORT} label="Support" className="mt-4" />
            {showAdminLink ? (
              <SheetGroup rows={ADMINISTRATION} label="Admin" className="mt-4" />
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border/60 bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pb-4">
            <button
              type="button"
              disabled={logoutPending}
              aria-busy={logoutPending}
              onClick={logout}
              className="focus-ring safe-motion flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-[#4E0401] transition-colors hover:bg-[#4E0401]/5 disabled:opacity-60 dark:text-red-200 dark:hover:bg-red-950/30"
            >
              <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[0.9375rem] font-semibold">{logoutPending ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetGroup({ rows, label, className }: { rows: SheetRow[]; label: string; className?: string }) {
  return (
    <section className={className}>
      <h2 className="px-1 pb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.11em] text-[#4E0401]/75 dark:text-[#FEFBF3]/60">
        {label}
      </h2>
      <div className="divide-y divide-border/45 border-y border-border/50">
        {rows.map((row) => {
          const quiet = row.emphasis === "quiet";

          return (
            <Dialog.Close asChild key={row.href}>
              <Link
                href={row.href}
                className="focus-ring safe-motion flex min-h-[54px] items-center gap-3 px-1 transition-colors hover:bg-secondary/35"
              >
                <row.icon
                  className={cn(
                    "h-5 w-5 shrink-0 text-[#4E0401]/65 dark:text-[#FEFBF3]/65",
                    quiet && "opacity-65"
                  )}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "flex-1 text-[0.9375rem] font-medium text-foreground",
                    quiet && "text-muted-foreground"
                  )}
                >
                  {row.label}
                </span>
                <ChevronRight
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground/75", quiet && "opacity-60")}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </Link>
            </Dialog.Close>
          );
        })}
      </div>
    </section>
  );
}
