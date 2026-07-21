import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, UsersRound, Bell, MessagesSquare, CalendarCheck2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";
import { BrandMark } from "./BrandMark";

const tabs = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/muddies", label: "Muddies", icon: UsersRound },
  { to: "/notifications", label: "Pulse", icon: Bell, badge: true },
  { to: "/messages", label: "Messages", icon: MessagesSquare },
  { to: "/plans", label: "Plans", icon: CalendarCheck2 }
];

/** The signed-in app frame: top header + scrollable content + bottom tab bar. */
export function AppShell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("avatar_url")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvatarUrl((data as { avatar_url?: string } | null)?.avatar_url ?? null));
  }, [user]);

  const loadUnread = useCallback(async () => {
    const result = await api.get<{ notifications: { is_read: boolean }[] }>("/api/notifications?limit=50");
    if (result.ok) setUnread(result.data.notifications.filter((n) => !n.is_read).length);
  }, []);

  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#111112]/90 py-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-4">
          <Link to="/home" aria-label="Mad Buddy home" className="focus-ring shrink-0">
            <BrandMark className="h-9 w-9" />
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/plans")}
              aria-label="Create"
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border bg-card/60 text-foreground transition-colors hover:bg-secondary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
            <Link
              to="/notifications"
              aria-label="Notifications"
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => navigate("/more")}
              aria-label="Account"
              className="focus-ring h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-sm font-semibold">
                  {(user?.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#111112]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <ul className="mx-auto flex w-full max-w-[30rem] items-stretch justify-between px-1">
          {tabs.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    "safe-motion flex min-h-[56px] flex-col items-center justify-center gap-1 py-2",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <tab.icon
                        className={cn("h-6 w-6", isActive && "fill-primary/20")}
                        aria-hidden="true"
                      />
                      {tab.badge && unread > 0 ? (
                        <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full border-2 border-[#111112] bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] font-medium leading-none">{tab.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** A standard page container with a title header (used by non-Home screens). */
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
