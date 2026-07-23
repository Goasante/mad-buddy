import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { InstallAppPrompt } from "@/components/pwa/install-app-prompt";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProtectedAppLayoutProps = {
  children: ReactNode;
};

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

// Every page in this group renders behind auth with per-request Supabase
// data; none may be statically prerendered at build time (build environments
// have no secrets, static export of these pages broke the Vercel build).
export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({ children }: ProtectedAppLayoutProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [adminContext, unreadResult, profileResult] = await Promise.all([
    getSafetyAdminContext(),
    user
      ? supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_read", false)
      : Promise.resolve({ count: 0 }),
    user
      ? supabase
          .from("profiles")
          .select("username, avatar_url, visibility_status")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return (
    <AppShell
      showAdminLink={adminContext.ok}
      initialUnreadCount={unreadResult.count ?? 0}
      locationSyncEnabled={profileResult.data?.visibility_status !== "ghost"}
      currentUsername={profileResult.data?.username ?? null}
      currentAvatarUrl={profileResult.data?.avatar_url ?? null}
    >
      {children}
      {/* Only offered once the user is signed in (mounted in the authed layout). */}
      <InstallAppPrompt />
    </AppShell>
  );
}
