"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ClipboardList,
  CreditCard,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  UsersRound
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const adminNavigationItems: Array<{
  href:
    | "/admin"
    | "/admin/users"
    | "/admin/reports"
    | "/admin/billing"
    | "/admin/system"
    | "/admin/audit"
    | "/admin/admins";
  label: string;
  icon: LucideIcon;
}> = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/users", label: "Users", icon: UsersRound },
  { href: "/admin/reports", label: "Reports", icon: ShieldAlert },
  { href: "/admin/billing", label: "Billing", icon: CreditCard },
  { href: "/admin/system", label: "System", icon: Activity },
  { href: "/admin/audit", label: "Audit", icon: ClipboardList },
  { href: "/admin/admins", label: "Admins", icon: ShieldCheck }
];

export type AdminShellProps = {
  children: ReactNode;
  email: string;
  isDevelopmentFallback: boolean;
};

export function AdminShell({ children, email, isDevelopmentFallback }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border bg-background/80 px-5 py-6 backdrop-blur-xl lg:block">
        <div className="flex h-full flex-col">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Management</p>
            <h1 className="mt-2 text-xl font-semibold">Mad Buddy Admin</h1>
            <Badge variant={isDevelopmentFallback ? "warning" : "blue"} className="mt-4">
              {isDevelopmentFallback ? "Local fallback" : "Restricted"}
            </Badge>
          </div>
          <nav className="mt-8 grid gap-2" aria-label="Admin navigation">
            {adminNavigationItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "focus-ring safe-motion flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3 rounded-lg border border-border bg-card/60 p-4">
            <p className="truncate text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-semibold">{email}</p>
            <Button type="button" variant="outline" size="sm" className="w-full" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to app
              </Link>
            </Button>
          </div>
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Admin</p>
              <h2 className="text-lg font-semibold">{activeLabel(pathname)}</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  App
                </Link>
              </Button>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Admin mobile navigation">
            {adminNavigationItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "focus-ring safe-motion inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                  pathname === item.href
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function activeLabel(pathname: string) {
  return adminNavigationItems.find((item) => item.href === pathname)?.label ?? "Admin";
}
