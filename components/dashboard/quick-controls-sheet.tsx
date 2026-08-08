"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import type { Route } from "next";
import {
  CircleDollarSign,
  Eye,
  EyeOff,
  Ghost,
  MessageSquareText,
  Monitor,
  Moon,
  RefreshCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserRound,
  type LucideIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

/**
 * Home's Quick Controls sheet.
 *
 * Everything here already existed on the Home dashboard as an always-visible
 * control strip (visibility, status, ghost mode, refresh nearby). Home showed
 * four controls permanently to serve occasional actions; they now live one tap
 * away instead, which is what lets Home lead with Journey and Nearby.
 *
 * This owns no business logic. Every control is handed in from
 * DashboardPageContent, which still holds the state and calls the same server
 * actions it always did — so there is exactly one implementation of each
 * control, not a copy.
 *
 * NO useDismissOnBack: the shortcut rows are <Link>s, and that hook's
 * Back-press cleanup calls history.back(), cancelling an in-flight App Router
 * navigation when the sheet closes as part of the same tap. Same reasoning as
 * MobileAccountMenu in components/app-shell/app-shell.tsx.
 */
export function QuickControlsSheet({
  open,
  onOpenChange,
  ghostMode,
  isPending,
  isCheckingNearby,
  statusMessage,
  statusSummary,
  hasActiveStatus,
  onToggleVisibility,
  onRefreshNearby,
  statusTrigger
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ghostMode: boolean;
  isPending: boolean;
  isCheckingNearby: boolean;
  statusMessage: string;
  statusSummary: string;
  hasActiveStatus: boolean;
  onToggleVisibility: () => void;
  onRefreshNearby: () => void;
  /** The existing StatusComposer, wired by the parent. Reused, not rebuilt. */
  statusTrigger: ReactNode;
}) {
  const { preference, setPreference } = useTheme();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-drop-overlay fixed inset-0 z-[60] bg-black/50 backdrop-blur-md" />
        <Dialog.Content className="modal-sheet-panel account-sheet-panel fixed inset-x-0 bottom-0 z-[61] flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[2rem] border border-b-0 border-border/80 bg-card pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-18px_60px_hsl(var(--shadow)/0.28)] outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-16 sm:max-h-[calc(100svh-5rem)] sm:w-[calc(100%-1.5rem)] sm:max-w-[26rem] sm:-translate-x-1/2 sm:rounded-[1.5rem] sm:border sm:pb-4">
          <Dialog.Title className="sr-only">Quick controls</Dialog.Title>

          <div className="flex shrink-0 justify-center pb-1 pt-3 sm:hidden" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-1 pt-2 sm:px-5">
            {/* Presence */}
            <QuickGroup label="Presence">
              <QuickRow
                icon={ghostMode ? EyeOff : Eye}
                label={ghostMode ? "Hidden from Muddies" : "Visible to Muddies"}
                description={ghostMode ? "Muddies can't see you nearby" : "Approved Muddies can see you nearby"}
                onClick={onToggleVisibility}
                disabled={isPending}
                trailing={<Switch on={!ghostMode} />}
              />
              {/* The real StatusComposer, passed down — same modal, same save
                  path, same validation as before. */}
              <div className="border-t border-border/60">{statusTrigger}</div>
            </QuickGroup>

            {/* Privacy. Ghost Mode is NOT a second toggle: in the data model
                it is the same single visibility flag as the row above
                (visibility_status "ghost" vs "visible"), so shipping two
                switches would be one control drawn twice — they would fight,
                and turning one "off" would appear to turn the other "on".
                This states the current mode and routes to the full Glow
                Visibility page, which owns the wider privacy settings. */}
            <QuickGroup label="Privacy" className="mt-5">
              <QuickLink
                href="/settings/glow-visibility"
                icon={Ghost}
                label="Ghost Mode"
                description={ghostMode ? "On — you're hidden" : "Off — approved Muddies can see you"}
              />
            </QuickGroup>

            {/* Nearby */}
            <QuickGroup label="Nearby" className="mt-5">
              <QuickRow
                icon={RefreshCcw}
                iconClassName={isCheckingNearby ? "animate-spin motion-reduce:animate-none" : undefined}
                label="Refresh Nearby"
                description={isCheckingNearby ? "Checking nearby Muddies…" : statusMessage || "Check who's around right now"}
                onClick={onRefreshNearby}
                disabled={isPending || isCheckingNearby}
              />
            </QuickGroup>

            {/* Safety */}
            <QuickGroup label="Safety" className="mt-5">
              <QuickLink href="/safe-arrival" icon={ShieldCheck} label="Safe Arrival" description="Let Muddies know you got there" />
            </QuickGroup>

            {/* Appearance */}
            <QuickGroup label="Appearance" className="mt-5">
              <div className="p-3">
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-secondary/50 p-1">
                  {(
                    [
                      { value: "system", label: "System", icon: Monitor },
                      { value: "light", label: "Day", icon: Sun },
                      { value: "dark", label: "Night", icon: Moon }
                    ] as const
                  ).map((option) => {
                    const isActive = preference === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPreference(option.value)}
                        aria-pressed={isActive}
                        className={cn(
                          "focus-ring safe-motion flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors",
                          isActive ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <option.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </QuickGroup>

            {/* Shortcuts — existing destinations only. */}
            <QuickGroup label="Shortcuts" className="mt-5">
              {/* Profile first: it is the destination people reach for most,
                  and it moved here when the bottom nav made room for Linkr. */}
              <QuickLink href="/profile" icon={UserRound} label="Profile" description="How other people see you" />
              <QuickLink href="/billing" icon={CircleDollarSign} label="Membership" description="Your plan and billing" divider />
              <QuickLink href="/buddy-score" icon={TrendingUp} label="My Progress" description="Buddy Score and activity" divider />
              <QuickLink href="/settings" icon={SettingsIcon} label="Settings" description="Preferences and account" divider />
            </QuickGroup>

            {/* Status summary, so the sheet reports what it just changed. */}
            {hasActiveStatus ? (
              <p className="mt-4 px-1 text-xs text-muted-foreground" role="status">
                <MessageSquareText className="mr-1 inline-block h-3.5 w-3.5 -translate-y-px" aria-hidden="true" />
                Current status: {statusSummary}
              </p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QuickGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="px-1 pb-2 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</h2>
      <div className="overflow-hidden rounded-2xl border border-border/70">{children}</div>
    </section>
  );
}

function QuickRow({
  icon: Icon,
  iconClassName,
  label,
  description,
  onClick,
  disabled,
  trailing
}: {
  icon: LucideIcon;
  iconClassName?: string;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring safe-motion flex min-h-[60px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-secondary/40 disabled:opacity-60"
    >
      <Icon className={cn("h-5 w-5 shrink-0 text-muted-foreground", iconClassName)} strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-medium">{label}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      {trailing}
    </button>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  description,
  divider
}: {
  href: Route;
  icon: LucideIcon;
  label: string;
  description: string;
  divider?: boolean;
}) {
  return (
    <Dialog.Close asChild>
      <Link
        href={href}
        className={cn(
          "focus-ring safe-motion flex min-h-[60px] items-center gap-3.5 px-4 py-3 transition-colors hover:bg-secondary/40",
          divider && "border-t border-border/60"
        )}
      >
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-medium">{label}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
        </span>
      </Link>
    </Dialog.Close>
  );
}

/** Presentational only — the row's button owns the interaction. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
        on ? "bg-primary" : "bg-secondary"
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          "absolute h-[20px] w-[20px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none",
          on ? "translate-x-[21px]" : "translate-x-[3px]"
        )}
      />
    </span>
  );
}
