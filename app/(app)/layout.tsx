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
import {
  MAD_CAM_FLAG,
  MOMENTS_FLAG,
  resolveGlobalFeatureFlag,
  SOCIALIZE_FLAG
} from "@/lib/features/feature-flags";
import { resolveWallpaperForRender } from "@/lib/wallpapers/service";
import { defaultResolvedWallpaper, type ResolvedWallpaper } from "@/lib/wallpapers/catalog";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { CONVERSATION_NOTIFICATION_TYPE_PATTERNS } from "@/lib/notifications/conversation-boundary";

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
  // Access retired the subscription read; Account Hub retired the Buddy Score
  // and profile-completion reads as dead menu consumers. Neither is loaded.
  const [adminContext, unreadResult, profileResult, shellFlagsResult] = await Promise.all([
    getSafetyAdminContext(),
    user
      ? supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[0])
          .not("type", "like", CONVERSATION_NOTIFICATION_TYPE_PATTERNS[1])
          .eq("is_read", false)
      : Promise.resolve({ count: 0 }),
    user
      ? supabase
          .from("profiles")
          // avatar_url/bio/mood_status feed the menu sheet's read-only
          // identity header (profile completion is the same three-item model
          // the Home reminder uses).
          // is_onboarded gates the redirect below (MB-GOD-049); it rides on
          // the query this layout already makes, so it costs no round trip.
          .select("username, avatar_url, visibility_status, full_name, is_onboarded")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // All shell-level flags in ONE query rather than one round trip each:
    // this layout blocks every page behind it, so a second and third
    // feature_flags lookup would be latency paid on every navigation.
    user
      ? supabase
          .from("feature_flags")
          .select("key, status, default_value")
          .in("key", [SOCIALIZE_FLAG, MOMENTS_FLAG, MAD_CAM_FLAG])
      : Promise.resolve({ data: null })
  ]);

  // Global pause. Staff are exempt so someone can still reach /admin to turn
  // it back off and verify the fix before reopening the app.
  if (maintenance && shouldBlockForMaintenance({ isActive: maintenance.isActive, isStaff: adminContext.ok })) {
    redirect("/maintenance");
  }

  /* UNFINISHED ONBOARDING RESUMES HERE (MB-GOD-049).
   *
   * Onboarding used to be reachable from exactly one place: the signup action
   * returning `redirectTo: "/onboarding"`. The login action never checks
   * `is_onboarded` -- it returns safeAuthNext(next), whose fallback is
   * /friends -- so anybody who arrived by logging in instead of by completing
   * signup walked straight past it.
   *
   * That path is real. `actions.ts:299` handles a failed auto-signin by
   * sending the person to /login with "Account created. Log in to continue.",
   * commenting that "nobody is stranded". They were: logging in put them in
   * the product with an empty display name and a machine-generated username
   * (`user_02748448`), which is how every other member would then see them,
   * and nothing routed them back.
   *
   * The guard belongs in this layout rather than in the login action because
   * the layout wraps EVERY authenticated route -- a deep link, a shared Plan
   * URL, a restored PWA session and an OAuth callback all pass through here,
   * and each was a separate way around a login-only check.
   *
   * `is_onboarded` is only false for someone who genuinely has not finished:
   * /onboarding self-heals a stranded-but-complete profile via
   * `recoverOnboardingIfStranded` and sends them straight back, so this cannot
   * trap an existing member in a loop. A missing profile row is left alone --
   * that state is not reachable through signup, and redirecting on it would
   * bounce accounts created by other means. */
  if (profileResult.data && profileResult.data.is_onboarded === false) {
    redirect("/onboarding");
  }

  // Server-authoritative wallpaper resolve — deliberately NOT awaited here.
  // AppShell unwraps this promise itself, inside its own Suspense boundary,
  // so the route commits (and navigation is considered complete) without
  // ever waiting on it, including the live Storage signed-URL call a custom
  // wallpaper requires. Still time-boxed and still never throws: a slow or
  // failed resolve falls back to the safe Mad Buddy Default, same as before,
  // just without blocking anything to get there.
  const wallpaperPromise: Promise<ResolvedWallpaper | null> =
    user
      ? withTimeout(resolveWallpaperForRender(createSupabaseAdminClient(), user.id, "free"), {
          operation: "resolveWallpaperForRender",
          timeoutMs: 3_000
        }).catch((error) => {
          if (!isRequestTimeoutError(error)) throw error;
          return defaultResolvedWallpaper(true);
        })
      : Promise.resolve(defaultResolvedWallpaper());

  /**
   * Flag resolution for the shell.
   *
   * A missing row means the feature is off: resolveGlobalFeatureFlag fails
   * closed, which is exactly why pausing Moments and Mad Cam needed no
   * migration. Seeding a row from Admin -> Features turns either back on.
   */
  const flagRows = (shellFlagsResult.data ?? []) as Array<{
    key: string;
    status: "off" | "on" | "rollout" | "archived";
    default_value: boolean;
  }>;
  const flagEnabled = (key: string) =>
    resolveGlobalFeatureFlag(flagRows.find((row) => row.key === key));

  const socializeEnabled = flagEnabled(SOCIALIZE_FLAG);
  const momentsEnabled = flagEnabled(MOMENTS_FLAG);
  const madCamEnabled = flagEnabled(MAD_CAM_FLAG);

  // A paused feature stops existing in navigation rather than appearing as a
  // dead or "coming soon" entry.
  const hiddenNavigationHrefs = [
    ...(socializeEnabled ? [] : ["/discover"]),
    ...(momentsEnabled ? [] : ["/moments"])
  ];

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
      currentUserId={user?.id ?? null}
      hiddenNavigationHrefs={hiddenNavigationHrefs}
      // Mad Cam is paused: without this the shell never mounts the camera
      // launcher or its lazy chunk. The camera code itself is untouched.
      madCamEnabled={madCamEnabled}
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
