import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Home,
  UsersRound,
  Bell,
  MessagesSquare,
  CalendarCheck2,
  Plus,
  Hand,
  Sparkles,
  UserRound,
  Settings,
  CircleDollarSign,
  LogOut,
  type LucideIcon
} from "lucide-react";
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

const createActions: { to: string; title: string; description: string; icon: LucideIcon }[] = [
  { to: "/plans", title: "New plan", description: "Create a hangout and invite Muddies", icon: CalendarCheck2 },
  { to: "/socialize", title: "Meeting ping", description: "Ask a Muddy to meet up nearby", icon: Hand },
  { to: "/moments", title: "Share a Moment", description: "Post a moment for your Muddies", icon: Sparkles }
];

export function AppShell() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("profiles")
      .select("avatar_url, username")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as { avatar_url?: string; username?: string } | null;
        setAvatarUrl(row?.avatar_url ?? null);
        setUsername(row?.username ?? null);
      });
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
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#111112]/90 py-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3 px-4">
          <Link to="/home" aria-label="Mad Buddy home" className="focus-ring shrink-0">
            <BrandMark className="h-9 w-9" />
          </Link>
          <div className="flex items-center gap-1.5">
            {/* Create dropdown */}
            <Dropdown
              label="Create"
              trigger={
                <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card/60 text-foreground">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </span>
              }
            >
              {(close) =>
                createActions.map((action) => (
                  <button
                    key={action.title}
                    type="button"
                    onClick={() => {
                      close();
                      navigate(action.to);
                    }}
                    className="focus-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left active:bg-secondary"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <action.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{action.title}</span>
                      <span className="block text-xs text-muted-foreground">{action.description}</span>
                    </span>
                  </button>
                ))
              }
            </Dropdown>

            {/* Bell — navigates */}
            <Link
              to="/notifications"
              aria-label="Notifications"
              className="focus-ring grid h-10 w-10 place-items-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </Link>

            {/* Account dropdown */}
            <Dropdown
              label="Account"
              trigger={
                <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full border border-border/70">
                  <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-secondary text-sm font-semibold">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (username ?? user?.email ?? "?").slice(0, 1).toUpperCase()
                    )}
                  </span>
                </span>
              }
            >
              {(close) => (
                <>
                  {username ? (
                    <p className="truncate px-3 pb-1.5 pt-1 text-xs font-medium text-muted-foreground">@{username}</p>
                  ) : null}
                  <AccountItem icon={UserRound} label="Profile" onClick={() => { close(); navigate("/profile"); }} />
                  <AccountItem icon={Settings} label="Settings" onClick={() => { close(); navigate("/settings"); }} />
                  <AccountItem icon={CircleDollarSign} label="Plan and billing" onClick={() => { close(); navigate("/subscription"); }} />
                  <div className="my-2 h-px bg-white/10" />
                  <button
                    type="button"
                    onClick={() => { close(); void signOut(); }}
                    className="focus-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-destructive active:bg-secondary"
                  >
                    <LogOut className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    Log out
                  </button>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        <Outlet />
      </main>

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
                      <tab.icon className={cn("h-6 w-6", isActive && "fill-primary/20")} aria-hidden="true" />
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

function Dropdown({
  label,
  trigger,
  children
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring block rounded-full transition-colors hover:opacity-90"
      >
        {trigger}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.45)]">
            {children(close)}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AccountItem({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm font-medium active:bg-secondary"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </button>
  );
}

export function Screen({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
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
