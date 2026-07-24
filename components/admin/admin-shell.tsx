"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  CreditCard,
  SlidersHorizontal,
  FileKey2,
  Gauge,
  Headphones,
  PowerOff,
  ToggleRight,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
  Wrench
} from "lucide-react";
import type { ReactNode } from "react";
import type { AdminPermission } from "@/lib/admin/governance";
import type { AdminAccessRole } from "@/lib/admin/access";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AdminHref =
  | "/admin"
  | "/admin/users"
  | "/admin/reports"
  | "/admin/support"
  | "/admin/repairs"
  | "/admin/billing"
  | "/admin/entitlements"
  | "/admin/features"
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
};

const adminNavigationGroups: Array<{ label: string; items: AdminNavigationItem[] }> = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: Gauge },
      { href: "/admin/users", label: "Users", icon: UsersRound, permission: "admin.users.view_summary" },
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
      { href: "/admin/features", label: "Feature controls", icon: ToggleRight, permission: "admin.feature_flags.manage" },
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
  const allowedGroups = adminNavigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.includes(item.permission))
  })).filter((group) => group.items.length > 0);
  const allowedItems = allowedGroups.flatMap((group) => group.items);

  return (
    <div className="min-h-screen bg-[#0d0e10] text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] border-r border-white/[0.08] bg-[#0a0b0d] lg:flex lg:flex-col">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.08] px-5">
          <BrandMark className="h-9 w-9" priority />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Mad Buddy</p>
            <p className="text-[11px] text-muted-foreground">Admin operations</p>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Admin navigation">
          <div className="space-y-5">
            {allowedGroups.map((group) => (
              <div key={group.label}>
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                  {group.label}
                </p>
                <ul className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const isActive = isAdminItemActive(item.href, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href as Route}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "focus-ring safe-motion flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium",
                            isActive
                              ? "bg-white/[0.08] text-white"
                              : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                          )}
                        >
                          <item.icon className={cn("h-4 w-4", isActive && "text-orange-400")} strokeWidth={1.8} aria-hidden="true" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="shrink-0 border-t border-white/[0.08] p-3">
          <div className="rounded-xl bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", isDevelopmentFallback ? "bg-amber-400" : "bg-emerald-400")} aria-hidden="true" />
              <p className="text-xs font-medium">{isDevelopmentFallback ? "Local access" : "Restricted access"}</p>
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground" title={email}>{email}</p>
            <p className="mt-1 text-[11px] capitalize text-muted-foreground">{role}</p>
            <Button type="button" variant="ghost" size="sm" className="mt-2 w-full justify-start px-2 shadow-none" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to app
              </Link>
            </Button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0d0e10]/90 backdrop-blur-xl">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Admin</p>
              <h2 className="truncate text-base font-semibold">{activeLabel(pathname)}</h2>
            </div>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Back to app</span>
                <span className="sm:hidden">App</span>
              </Link>
            </Button>
          </div>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto border-t border-white/[0.06] px-3 py-2 lg:hidden" aria-label="Admin mobile navigation">
            {allowedItems.map((item) => {
              const isActive = isAdminItemActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "focus-ring safe-motion inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium",
                    isActive ? "bg-white/[0.08] text-white" : "text-muted-foreground hover:bg-white/[0.04]"
                  )}
                >
                  <item.icon className={cn("h-3.5 w-3.5", isActive && "text-orange-400")} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
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
