"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import type { Route } from "next";
import {
  Award,
  ChevronRight,
  CircleDollarSign,
  HelpCircle,
  Info,
  LifeBuoy,
  LogOut,
  MapPin,
  Settings as SettingsIcon,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSecureLogout } from "@/components/auth/use-secure-logout";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { premiumBadgeIdentity } from "@/lib/billing/premium-identity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type SheetRow = {
  href: Route;
  label: string;
  icon: LucideIcon;
};

/**
 * Shortcuts to the destinations people reach for most. These duplicate no
 * page — each points at the one canonical route that already owns it. The
 * Home avatar remains the primary way into the Me hub; these are the
 * secondary path, which is why "View My Profile" is a labelled row here
 * rather than a tap target on the identity header above it.
 */
const QUICK_ACCESS: SheetRow[] = [
  { href: "/profile", label: "View My Profile", icon: UserRound },
  { href: "/billing", label: "Membership", icon: CircleDollarSign },
  { href: "/buddy-score", label: "My Progress", icon: TrendingUp },
  { href: "/badges", label: "Achievements", icon: Award }
];

/** Preferences — everything that changes how the app behaves. */
const PREFERENCES: SheetRow[] = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
  { href: "/settings/privacy", label: "Privacy & Safety", icon: ShieldCheck },
  { href: "/settings/glow-visibility", label: "Location & Permissions", icon: MapPin }
];

/**
 * Support and about. "Developer Updates" from the design brief is absent
 * deliberately: there is no changelog/release-notes route in the app today,
 * and pointing the row at an unrelated page would be worse than omitting it.
 */
const SUPPORT: SheetRow[] = [
  { href: "/invites", label: "Invite Friends", icon: UserPlus },
  { href: "/help", label: "Help & Support", icon: HelpCircle },
  { href: "/settings/feedback", label: "Send Feedback", icon: LifeBuoy },
  { href: "/about", label: "About Mad Buddy", icon: Info }
];

/**
 * Home's account sheet — opens from the header hamburger.
 *
 * Structure follows iOS Settings / Apple Wallet: a read-only identity header
 * at the top, then grouped, inset-rounded row lists. The header is
 * deliberately NOT a link — the Home avatar already opens the Me hub, and a
 * second tappable path to the same place is the duplication this redesign
 * exists to remove. It shows state (who you are, your plan, how complete your
 * profile is); the rows below do the navigating.
 *
 * Reuses Modal's sheet CSS (modal-drop-overlay / modal-sheet-panel: spring
 * slide-up, safe-area padding, reduced-motion handling) directly via Radix
 * Dialog rather than through <Modal>, because this needs a custom header
 * instead of Modal's fixed title/close-X row.
 *
 * NO useDismissOnBack here — every row is a <Link>, and that hook's Back-press
 * cleanup calls history.back(), which cancels an in-flight App Router
 * navigation when the sheet closes as part of the same click. Same reasoning
 * as MobileAccountMenu in components/app-shell/app-shell.tsx.
 */
export function HomeSettingsSheet({
  open,
  onOpenChange,
  displayName,
  currentUsername,
  currentAvatarUrl,
  subscriptionPlan,
  buddyScoreLevelLabel,
  profileCompletionPercent
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  subscriptionPlan: SubscriptionPlan | null | undefined;
  /** Display label only ("Trusted Buddy"); null when unavailable. */
  buddyScoreLevelLabel: string | null;
  /** 0–100, from the same three-item model the profile reminder uses. */
  profileCompletionPercent: number;
}) {
  const { logout, isPending: logoutPending } = useSecureLogout();
  const initial = (displayName || currentUsername || "?").charAt(0).toUpperCase();
  const identity = premiumBadgeIdentity(subscriptionPlan);
  const isProfileComplete = profileCompletionPercent >= 100;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 z-[60] bg-black/50 backdrop-blur-md" />
        <Dialog.Content className="modal-sheet-panel menu-sheet-panel fixed inset-x-0 bottom-0 z-[61] flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[2rem] border border-b-0 border-border/80 bg-card pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)] outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:w-[calc(100%-1.5rem)] sm:max-w-[26rem] sm:-translate-x-1/2 sm:rounded-[1.5rem] sm:border sm:pb-4">
          <Dialog.Title className="sr-only">Account and settings</Dialog.Title>

          {/* Drag handle — decorative; the sheet isn't draggable, but this is
              the expected affordance for a bottom sheet. */}
          <div className="flex shrink-0 justify-center pb-1 pt-3 sm:hidden" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1 pt-2 sm:px-5">
            {/* Identity header — read-only. No href, no onClick. */}
            <div className="flex items-center gap-3.5 px-1 pb-1">
              <span
                className={cn(
                  "grid h-14 w-14 shrink-0 place-items-center rounded-full p-[2px]",
                  identity?.tier === "pro" && "avatar-ring-pro",
                  identity?.tier === "plus" && "bg-indigo-500"
                )}
              >
                <UserAvatar
                  src={currentAvatarUrl}
                  name={initial}
                  size="sm"
                  decorative
                  className={cn("h-full w-full", identity ? "border-2 border-background" : undefined)}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 truncate text-[1.0625rem] font-semibold leading-tight">
                    {displayName || currentUsername || "Your account"}
                  </p>
                  <PremiumPlanBadge plan={subscriptionPlan} compact />
                </div>
                {currentUsername ? (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">@{currentUsername}</p>
                ) : null}
                {/* Read-only context: reputation level and, while it is still
                    worth acting on, profile completeness. Both are status,
                    not controls — the Quick Access rows below do the
                    navigating. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {buddyScoreLevelLabel ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
                      <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
                      {buddyScoreLevelLabel}
                    </span>
                  ) : null}
                  {buddyScoreLevelLabel && !isProfileComplete ? (
                    <span className="text-muted-foreground/50" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  {!isProfileComplete ? (
                    <span className="text-xs font-medium text-muted-foreground">
                      Profile {profileCompletionPercent}% complete
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <SheetGroup rows={QUICK_ACCESS} label="Quick access" className="mt-4" />
            <SheetGroup rows={PREFERENCES} label="Preferences" className="mt-5" />
            <SheetGroup rows={SUPPORT} label="Support" className="mt-5" />

            <button
              type="button"
              disabled={logoutPending}
              onClick={logout}
              className="focus-ring safe-motion mt-5 flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-border/70 px-4 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
            >
              <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[0.9375rem] font-semibold">Log out</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One inset-rounded, iOS-Settings-style group of rows. */
function SheetGroup({ rows, label, className }: { rows: SheetRow[]; label: string; className?: string }) {
  return (
    <section className={className}>
      <h2 className="px-1 pb-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border/70">
        {rows.map((row, index) => (
          <Dialog.Close asChild key={row.href}>
            <Link
              href={row.href}
              className={cn(
                "focus-ring safe-motion flex min-h-[52px] items-center gap-3.5 px-4 transition-colors hover:bg-secondary/40",
                index > 0 && "border-t border-border/60"
              )}
            >
              <row.icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1 text-[0.9375rem] font-medium">{row.label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </Dialog.Close>
        ))}
      </div>
    </section>
  );
}
