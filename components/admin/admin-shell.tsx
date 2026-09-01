"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  Compass,
  CreditCard,
  FileKey2,
  FlaskConical,
  Gauge,
  Headphones,
  Image as ImageIcon,
  Menu,
  PowerOff,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  ToggleRight,
  Trophy,
  UsersRound,
  Wrench,
  X
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AdminPermission } from "@/lib/admin/governance";
import type { AdminAccessRole } from "@/lib/admin/access";
import { BrandSymbol } from "@/components/brand/brand-symbol";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AdminHref =
  | "/admin"
  | "/admin/users"
  | "/admin/trusted-members"
  | "/admin/reports"
  | "/admin/support"
  | "/admin/repairs"
  | "/admin/billing"
  | "/admin/entitlements"
  | "/admin/analytics"
  | "/admin/revenue"
  | "/admin/buddy-score"
  | "/admin/features"
  | "/admin/experiments"
  | "/admin/wallpapers"
  | "/admin/tours"
  | "/admin/privacy"
  | "/admin/system"
  | "/admin/maintenance"
  | "/admin/audit"
  | "/admin/admins";

type AdminNavigationItem = {
  href: AdminHref;
  label: string;
  icon: LucideIcon;
  permission?: AdminPermission;
  ownerOnly?: boolean;
};

type AdminNavigationGroup = { label: string; items: AdminNavigationItem[] };

const adminNavigationGroups: AdminNavigationGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: Gauge },
      { href: "/admin/users", label: "Users", icon: UsersRound, permission: "admin.users.view_summary" },
      { href: "/admin/trusted-members", label: "Trusted Members", icon: ShieldCheck, permission: "admin.verification.review" },
      { href: "/admin/reports", label: "Reports", icon: ShieldAlert, permission: "admin.reports.review" },
      { href: "/admin/support", label: "Support", icon: Headphones, permission: "admin.support.manage" },
      { href: "/admin/repairs", label: "Repairs", icon: Wrench, permission: "admin.support.manage" }
    ]
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/billing", label: "Billing", icon: CreditCard, permission: "admin.billing.view" },
      { href: "/admin/entitlements", label: "Entitlements", icon: SlidersHorizontal, permission: "admin.entitlements.view" },
      { href: "/admin/analytics", label: "Analytics", icon: ChartNoAxesCombined, permission: "admin.analytics.view" },
      { href: "/admin/revenue", label: "Revenue", icon: CircleDollarSign, permission: "admin.revenue.view" },
      { href: "/admin/buddy-score", label: "Buddy Score", icon: Trophy, permission: "admin.buddy_score.manage" },
      { href: "/admin/features", label: "Feature controls", icon: ToggleRight, permission: "admin.feature_flags.manage" },
      { href: "/admin/experiments", label: "Experiments", icon: FlaskConical, permission: "admin.experiments.manage", ownerOnly: true },
      { href: "/admin/wallpapers", label: "Wallpapers", icon: ImageIcon, permission: "admin.wallpapers.manage", ownerOnly: true },
      { href: "/admin/tours", label: "Product tours", icon: Compass, permission: "admin.tours.manage" },
      { href: "/admin/privacy", label: "Privacy", icon: FileKey2, permission: "admin.privacy.requests.manage" },
      { href: "/admin/system", label: "App health", icon: Activity, permission: "admin.security.events.view" },
      { href: "/admin/maintenance", label: "Maintenance", icon: PowerOff, permission: "admin.maintenance.manage" }
    ]
  },
  {
    label: "Governance",
    items: [
      { href: "/admin/audit", label: "Audit log", icon: ClipboardList, permission: "admin.audit.view" },
      { href: "/admin/admins", label: "Admin team", icon: ShieldCheck, permission: "admin.roles.manage" }
    ]
  }
];

const adminNavigationItems = adminNavigationGroups.flatMap((group) => group.items);

export type AdminShellProps = {
  children: ReactNode;
  email: string;
  isDevelopmentFallback: boolean;
  permissions: AdminPermission[];
  role: AdminAccessRole;
};

export function AdminShell({ children, email, isDevelopmentFallback, permissions, role }: AdminShellProps) {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const allowedGroups = adminNavigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => (!item.permission || permissions.includes(item.permission)) && (!item.ownerOnly || role === "owner")
      )
    }))
    .filter((group) => group.items.length > 0);
  const currentItem = adminNavigationItems.find((item) => isAdminItemActive(item.href, pathname));
  const CurrentIcon = currentItem?.icon ?? Gauge;

  return (
    <div className="relative min-h-screen min-h-[100svh] overflow-x-hidden bg-[#090a0c] text-[#f7f4ef]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_82%_2%,rgba(232,140,43,0.10),transparent_30%),radial-gradient(circle_at_15%_95%,rgba(78,4,1,0.20),transparent_34%)]"
      />

      <aside className="fixed inset-y-3 left-3 z-40 hidden w-[272px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0f1013]/95 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl lg:flex lg:flex-col">
        <AdminRailHeader />
        <AdminNavigation groups={allowedGroups} pathname={pathname} />
        <AdminIdentityCard email={email} isDevelopmentFallback={isDevelopmentFallback} role={role} />
      </aside>

      {mobileNavigationOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close admin navigation"
            onClick={() => setMobileNavigationOpen(false)}
          />
          <aside className="absolute bottom-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] left-[calc(env(safe-area-inset-left,0px)+0.5rem)] top-[calc(env(safe-area-inset-top,0px)+0.5rem)] flex w-[min(88vw,320px)] flex-col overflow-hidden rounded-[28px] border border-white/[0.10] bg-[#0f1013] shadow-[0_24px_80px_rgba(0,0,0,0.48)]">
            <div className="relative">
              <AdminRailHeader />
              <button
                type="button"
                className="focus-ring absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white"
                onClick={() => setMobileNavigationOpen(false)}
                aria-label="Close admin navigation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <AdminNavigation
              groups={allowedGroups}
              pathname={pathname}
              onNavigate={() => setMobileNavigationOpen(false)}
            />
            <AdminIdentityCard email={email} isDevelopmentFallback={isDevelopmentFallback} role={role} />
          </aside>
        </div>
      ) : null}

      <div className="relative lg:pl-[300px]">
        <header className="sticky top-0 z-30 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] lg:px-8 lg:pt-4">
          <div className="mx-auto flex min-h-16 max-w-[1560px] items-center justify-between gap-4 rounded-[22px] border border-white/[0.08] bg-[#0f1013]/86 px-3 shadow-[0_14px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl sm:px-4 lg:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavigationOpen(true)}
                className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white lg:hidden"
                aria-label="Open admin navigation"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-[#E88C2B]/20 bg-[#E88C2B]/10 text-[#f2a253]">
                <CurrentIcon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d89a61]">Admin workspace</p>
                <h2 className="truncate text-sm font-semibold text-white sm:text-base">{activeLabel(pathname)}</h2>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-[11px] font-medium text-emerald-200 sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                Secure session
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-white/[0.10] bg-white/[0.035] text-white shadow-none hover:bg-white/[0.07]"
                asChild
              >
                <Link href="/dashboard">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Back to app</span>
                  <span className="sm:hidden">App</span>
                </Link>
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1560px] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(3rem,env(safe-area-inset-bottom))] pt-5 sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))] sm:pt-6 lg:px-8 lg:pb-16 lg:pt-7">
          {children}
        </main>
      </div>
    </div>
  );
}

function AdminRailHeader() {
  return (
    <div className="flex min-h-[86px] shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border border-[#E88C2B]/20 bg-[linear-gradient(145deg,rgba(232,140,43,0.16),rgba(78,4,1,0.14))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <BrandSymbol className="h-8 w-8" priority />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">Mad Buddy</p>
        <p className="mt-0.5 text-[11px] font-medium text-[#b4aea7]">Command center</p>
      </div>
    </div>
  );
}

function AdminNavigation({
  groups,
  pathname,
  onNavigate
}: {
  groups: AdminNavigationGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Admin navigation">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#77736f]">{group.label}</p>
            <ul className="mt-2 space-y-1">
              {group.items.map((item) => {
                const isActive = isAdminItemActive(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href as Route}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "focus-ring safe-motion group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-[15px] border px-2.5 text-sm font-medium",
                        isActive
                          ? "border-[#E88C2B]/20 bg-[linear-gradient(90deg,rgba(232,140,43,0.14),rgba(232,140,43,0.045))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                          : "border-transparent text-[#aaa59f] hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-white"
                      )}
                    >
                      {isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#E88C2B]" aria-hidden="true" /> : null}
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-[11px] transition-colors",
                          isActive ? "bg-[#E88C2B]/12 text-[#f1a35c]" : "bg-white/[0.035] text-[#8f8a84] group-hover:text-[#d8d3cc]"
                        )}
                      >
                        <item.icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function AdminIdentityCard({
  email,
  isDevelopmentFallback,
  role
}: {
  email: string;
  isDevelopmentFallback: boolean;
  role: AdminAccessRole;
}) {
  return (
    <div className="shrink-0 border-t border-white/[0.07] p-3">
      <div className="rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", isDevelopmentFallback ? "bg-amber-400" : "bg-emerald-400")} aria-hidden="true" />
            <p className="text-xs font-medium text-[#d9d4ce]">{isDevelopmentFallback ? "Local access" : "Restricted access"}</p>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9e9993]">
            {role}
          </span>
        </div>
        <p className="mt-3 truncate text-xs text-[#8f8a84]" title={email}>{email}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2.5 w-full justify-start rounded-xl px-2 text-[#b8b2ac] shadow-none hover:bg-white/[0.05] hover:text-white"
          asChild
        >
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Mad Buddy
          </Link>
        </Button>
      </div>
    </div>
  );
}

function isAdminItemActive(href: AdminHref, pathname: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function activeLabel(pathname: string) {
  return adminNavigationItems.find((item) => isAdminItemActive(item.href, pathname))?.label ?? "Admin";
}
