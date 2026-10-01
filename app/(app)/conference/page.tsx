import { redirect } from "next/navigation";
import { ConferencePage } from "@/components/conference/conference-page";
import { loadConferenceFeed } from "@/lib/conference/server";
import { getCurrentIdentity } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CONFERENCE_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";
import type { ConferenceSort } from "@/lib/conference/types";

export const dynamic = "force-dynamic";

export default async function ConferenceRoute({
  searchParams
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const [identity, params, enabled] = await Promise.all([
    getCurrentIdentity(),
    searchParams,
    isFeatureEnabled(createSupabaseAdminClient(), CONFERENCE_FLAG)
  ]);
  if (!identity) redirect("/login?next=/conference");
  if (!enabled) redirect("/dashboard");

  const sort: ConferenceSort = params.sort === "hot" ? "hot" : "fresh";
  const feed = await loadConferenceFeed(identity.id, sort);
  return <ConferencePage feed={feed} sort={sort} />;
}
