import { MomentsPage, type MomentAudienceOption } from "@/components/content/moments-page";
import { checkFeature } from "@/lib/billing/entitlements";
import { resolveUserEntitlements } from "@/lib/billing/service";
import { buildMomentFeed, buildOpenMomentFeed } from "@/lib/content/service";
import { isOpenMomentsEnabled } from "@/lib/features/feature-flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function MomentsRoute() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const env = getSupabaseServerEnv();
  if (!user || !env.url || !env.serviceRoleKey) {
    return <MomentsPage initialMoments={[]} initialOpenMoments={[]} circles={[]} />;
  }

  const admin = createSupabaseAdminClient();
  const [moments, circles, openMomentsEnabled, entitlements] = await Promise.all([
    buildMomentFeed(admin, user.id),
    loadCircles(admin, user.id),
    isOpenMomentsEnabled(admin),
    resolveUserEntitlements(admin, user.id)
  ]);
  const openMoments = openMomentsEnabled ? await buildOpenMomentFeed(admin, user.id) : [];

  return (
    <MomentsPage
      initialMoments={moments}
      initialOpenMoments={openMoments}
      circles={circles}
      openMomentsEnabled={openMomentsEnabled}
      canPublishOpenMoments={checkFeature(entitlements, "public_moments")}
    />
  );
}

async function loadCircles(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<MomentAudienceOption[]> {
  const { data } = await admin
    .from("friend_circles")
    .select("id, name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []).map((circle) => ({ id: circle.id, name: circle.name }));
}
