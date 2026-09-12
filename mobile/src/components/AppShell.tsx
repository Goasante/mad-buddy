import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { AppHeader } from "@/components/app-shell/app-header";
import { isBuiltForMobile } from "@/lib/platform";
/* Registers the header's menus with the native overlay stack so the hardware
   Back button CLOSES an open menu instead of leaving the screen. Web passes
   nothing: its equivalent hook calls history.back(), which would cancel the
   navigation a menu item just started. */
import { useOverlayDismiss } from "../lib/overlay";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { api } from "../lib/api";

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
      {/* THE SHARED HEADER.
          This was a hand-written header with its own Create dropdown, bell
          and account menu, none of which tracked the web app. It now renders
          the SAME component the web shell uses.

          Two props carry everything platform-specific:
          - onLogout is AuthProvider.signOut, which removes this device's
            push token BEFORE clearing the Supabase session. Web passes its
            own Server-Action logout. Neither platform borrows the other's
            lifecycle.
          - isBuiltForMobile omits menu entries pointing at destinations this
            app does not have (Admin), rather than offering a dead item.

          showNotificationsBell is on here and off on web: web pages render
          their own MobilePageHeader which already carries a bell, and this
          app has no per-page header. */}
      <AppHeader
        currentUsername={username}
        currentAvatarUrl={avatarUrl}
        onLogout={() => { void signOut(); }}
        isDestinationAvailable={isBuiltForMobile}
        homeHref="/home"
        showNotificationsBell
        useOverlayDismiss={useOverlayDismiss}
      />

      {/* The shared header is FIXED, so it is out of flow and reserves no
          space of its own -- <main> has to.

          CONTENT-HEIGHT, NOT THE FULL HEADER HEIGHT. This app's `body` already
          carries `padding: env(safe-area-inset-top) ...` (mobile/src/index.css),
          so the notch is paid for once before <main> is laid out at all.
          --app-header-height bundles that same inset, so using it here would
          count the notch twice and open a visible gap beneath the header.
          The header itself still needs its own inset padding because `fixed`
          positions against the viewport and ignores body padding entirely --
          which is exactly why the two values exist separately. */}
      <main
        className="flex-1 overflow-y-auto pb-24"
        style={{ paddingTop: "var(--app-header-content-height)" }}
      >
        <Outlet />
      </main>

      {/* THE SHARED NAVIGATION.
          This was a hand-written bar with its own tabs
          (Home/Muddies/Pulse/Messages/Plans) that had drifted months behind
          the web app -- the most visible symptom of maintaining two apps.
          It now renders the SAME component the web shell uses, so the two
          cannot diverge again.

          `isBuiltForMobile` is what makes that safe: Linkr and UpFor exist in
          the shared tab list but not in this app yet, so they keep their slot
          (the layout matches web) while being dimmed and unable to navigate.
          Without it they would route to the unavailable screen. */}
      <MobileNav
        onHomeReselect={() => navigate("/home")}
        messageUnreadCount={unread}
        isDestinationAvailable={isBuiltForMobile}
      />
    </div>
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
