import { GlowVisibilityPage } from "@/components/settings/glow-visibility-page";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { VisibilityStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export default async function SettingsGlowVisibilityPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("visibility_status").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const env = getSupabaseServerEnv();
  let circles: Array<{ id: string; name: string; icon: string | null }> = [];
  let activeSession: {
    visibilityMode: "all_muddies" | "selected_circles" | "close_friends" | "hidden";
    endsAt: string | null;
    circleIds: string[];
  } | null = null;

  if (user && env.url && env.serviceRoleKey) {
    const admin = createSupabaseAdminClient();
    const { data: circleRows } = await admin
      .from("friend_circles")
      .select("id, name, icon")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    circles = circleRows ?? [];

    const { data: session } = await admin
      .from("visibility_sessions")
      .select("id, visibility_mode, ends_at")
      .eq("user_id", user.id)
      .eq("feature_type", "glow")
      .eq("status", "active")
      .maybeSingle();

    if (session) {
      const { data: targets } = await admin
        .from("visibility_targets")
        .select("target_id, target_type, access_type")
        .eq("session_id", session.id);
      activeSession = {
        visibilityMode: session.visibility_mode,
        endsAt: session.ends_at,
        circleIds: (targets ?? [])
          .filter((t) => t.access_type === "include" && t.target_type === "circle")
          .map((t) => t.target_id)
      };
    }
  }

  return (
    <GlowVisibilityPage
      initialVisibilityStatus={(profile?.visibility_status ?? "visible") as VisibilityStatus}
      circles={circles}
      activeSession={activeSession}
    />
  );
}
