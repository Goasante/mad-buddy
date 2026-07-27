import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { EnableNotificationsPrompt } from "@/components/pwa/enable-notifications-prompt";
import { InstallAppPrompt } from "@/components/pwa/install-app-prompt";
import { ensureMaintenanceWarm } from "@/lib/maintenance/loader";
import { shouldBlockForMaintenance } from "@/lib/maintenance/state";
import { getSafetyAdminContext } from "@/lib/safety/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveGlobalFeatureFlag, SOCIALIZE_FLAG } from "@/lib/features/feature-flags";
import { getCurrentSubscriptionAccess } from "@/lib/premium/access";
import { resolveWallpaperForRender } from "@/lib/wallpapers/service";
import { defaultResolvedWallpaper } from "@/lib/wallpapers/catalog";

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
  // getCurrentUser() is the shared per-request auth round trip; the RLS client
  // below is only for this layout's own queries.
  const [supabase, user] = await Promise.all([createSupabaseServerClient(), getCurrentUser()]);
  const [adminContext, unreadResult, profileResult, socializeFlagResult] = await Promise.all([
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
      : Promise.resolve({ data: null }),
    user
      ? supabase
          .from("feature_flags")
          .select("status, default_value")
          .eq("key", SOCIALIZE_FLAG)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  // Global pause. Staff are exempt so someone can still reach /admin to turn
  // it back off and verify the fix before reopening the app.
  const env = getSupabaseServerEnv();
  if (env.url && env.serviceRoleKey) {
    const maintenance = await ensureMaintenanceWarm(createSupabaseAdminClient());
    if (shouldBlockForMaintenance({ isActive: maintenance.isActive, isStaff: adminContext.ok })) {
      redirect("/maintenance");
    }
  }

  // Server-authoritative wallpaper resolve. Never throws; failure → the safe
  // Mad Buddy Default, so the background never blocks or breaks a page.
  let wallpaper = defaultResolvedWallpaper();
  if (user && env.url && env.serviceRoleKey) {
    try {
      const access = await getCurrentSubscriptionAccess(user.id);
      wallpaper = await resolveWallpaperForRender(createSupabaseAdminClient(), user.id, access.plan);
    } catch {
      // keep the default
    }
  }

  return (
    <AppShell
      showAdminLink={adminContext.ok}
      initialUnreadCount={unreadResult.count ?? 0}
      locationSyncEnabled={profileResult.data?.visibility_status !== "ghost"}
      currentUsername={profileResult.data?.username ?? null}
      currentAvatarUrl={profileResult.data?.avatar_url ?? null}
      currentUserId={user?.id ?? null}
      hiddenNavigationHrefs={resolveGlobalFeatureFlag(socializeFlagResult.data) ? [] : ["/discover"]}
      wallpaper={wallpaper}
    >
      {children}
      {/* Only offered once the user is signed in (mounted in the authed layout). */}
      <InstallAppPrompt />
      {user ? <EnableNotificationsPrompt userId={user.id} /> : null}
    </AppShell>
  );
}
