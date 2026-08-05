import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { TourHost } from "@/components/tours/tour-host";
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
import { defaultResolvedWallpaper, type ResolvedWallpaper } from "@/lib/wallpapers/catalog";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { loadBuddyScoreLevel } from "@/lib/engagement/buddy-score-service";

/**
 * The same three-item completion model the Home profile reminder uses: photo,
 * bio, mood. Resolved once here rather than per screen, so the shared menu
 * sheet shows one consistent number app-wide.
 */
function profileCompletionPercent(
  profile: { avatar_url?: string | null; bio?: string | null; mood_status?: string | null } | null | undefined
): number {
  if (!profile) return 0;
  const done = [profile.avatar_url, profile.bio?.trim(), profile.mood_status?.trim()].filter(Boolean).length;
  return Math.round((done / 3) * 100);
}

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
  // below is only for this layout's own queries. ensureMaintenanceWarm() needs
  // no user, so it starts here too instead of waiting behind everything else.
  const env = getSupabaseServerEnv();
  const [supabase, user, maintenance] = await Promise.all([
    createSupabaseServerClient(),
    getCurrentUser(),
    env.url && env.serviceRoleKey ? ensureMaintenanceWarm(createSupabaseAdminClient()) : Promise.resolve(null)
  ]);

  // Every remaining lookup here only needs `user`/`env`, not each other's
  // results, so they run together instead of one sequential await chain
  // (auth -> maintenance -> subscription -> wallpaper) that previously meant
  // this layout's total latency was the SUM of five round trips instead of
  // the slowest one. This was blocking every page behind this layout, which
  // is why unrelated destinations (Profile, Settings, Billing, Help, Admin)
  // were all affected together.
  const [adminContext, unreadResult, profileResult, socializeFlagResult, access, buddyScoreLevel] =
    await Promise.all([
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
          // avatar_url/bio/mood_status feed the menu sheet's read-only
          // identity header (profile completion is the same three-item model
          // the Home reminder uses).
          .select("username, avatar_url, visibility_status, full_name, bio, mood_status")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user
      ? supabase
          .from("feature_flags")
          .select("status, default_value")
          .eq("key", SOCIALIZE_FLAG)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    user && env.url && env.serviceRoleKey ? getCurrentSubscriptionAccess(user.id) : Promise.resolve(null),
    // Buddy Score level for the shared menu sheet's identity header. Runs in
    // the same parallel batch, so it adds no serial latency, and it is the
    // read-only loader (never reconciles, never writes).
    user && env.url && env.serviceRoleKey
      ? loadBuddyScoreLevel(createSupabaseAdminClient(), user.id)
      : Promise.resolve(null)
  ]);

  // Global pause. Staff are exempt so someone can still reach /admin to turn
  // it back off and verify the fix before reopening the app.
  if (maintenance && shouldBlockForMaintenance({ isActive: maintenance.isActive, isStaff: adminContext.ok })) {
    redirect("/maintenance");
  }

  // Server-authoritative wallpaper resolve — deliberately NOT awaited here.
  // AppShell unwraps this promise itself, inside its own Suspense boundary,
  // so the route commits (and navigation is considered complete) without
  // ever waiting on it, including the live Storage signed-URL call a custom
  // wallpaper requires. Still time-boxed and still never throws: a slow or
  // failed resolve falls back to the safe Mad Buddy Default, same as before,
  // just without blocking anything to get there.
  const wallpaperPromise: Promise<ResolvedWallpaper | null> =
    user && access
      ? withTimeout(resolveWallpaperForRender(createSupabaseAdminClient(), user.id, access.plan), {
          operation: "resolveWallpaperForRender",
          timeoutMs: 3_000
        }).catch((error) => {
          if (!isRequestTimeoutError(error)) throw error;
          return defaultResolvedWallpaper(true);
        })
      : Promise.resolve(defaultResolvedWallpaper());

  return (
    <AppShell
      showAdminLink={adminContext.ok}
      initialUnreadCount={unreadResult.count ?? 0}
      locationSyncEnabled={profileResult.data?.visibility_status !== "ghost"}
      currentUsername={profileResult.data?.username ?? null}
      currentAvatarUrl={profileResult.data?.avatar_url ?? null}
      // Identity for the shared menu sheet, resolved once here rather than
      // per screen.
      currentDisplayName={profileResult.data?.full_name?.split(" ")[0] || ""}
      subscriptionPlan={access?.plan ?? null}
      buddyScoreLevelLabel={buddyScoreLevel?.label ?? null}
      // Same three-item completion model the Home reminder uses.
      profileCompletionPercent={profileCompletionPercent(profileResult.data)}
      currentUserId={user?.id ?? null}
      hiddenNavigationHrefs={resolveGlobalFeatureFlag(socializeFlagResult.data) ? [] : ["/discover"]}
      wallpaperPromise={wallpaperPromise}
    >
      {children}
      {/* Only offered once the user is signed in (mounted in the authed layout). */}
      <InstallAppPrompt />
      {user ? <EnableNotificationsPrompt userId={user.id} /> : null}
      {/* Guided tours, behind their own Suspense boundary so tour eligibility
          can never delay the route committing — the lesson from the wallpaper
          regression. Renders nothing for anyone who has already resolved the
          current tour version, which is nearly every load. */}
      {user ? (
        <Suspense fallback={null}>
          <TourHost userId={user.id} />
        </Suspense>
      ) : null}
    </AppShell>
  );
}
