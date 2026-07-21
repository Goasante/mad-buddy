import { NavLink, Outlet } from "react-router-dom";
import { Home, Users, CalendarDays, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/muddies", label: "Muddies", icon: Users },
  { to: "/plans", label: "Plans", icon: CalendarDays },
  { to: "/notifications", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings }
];

/** The signed-in app frame: scrollable content + a fixed bottom tab bar. */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 overflow-y-auto pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  "focus-ring flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]")} aria-hidden="true" />
                  {tab.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** A standard page container with a title header. */
export function Screen({
  title,
  action,
  children
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 pt-6">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {action}
      </header>
      {children}
    </div>
  );
}
