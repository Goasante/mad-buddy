
import { LockedFeaturePreview } from "@/components/features/locked-feature-preview";
import { optionalFeatureEnabled } from "@/lib/features/availability-server";
import { redirect } from "next/navigation";
import { ConferenceTopicPage } from "@/components/conference/conference-topic-page";
import { loadConferenceTopic } from "@/lib/conference/server";
import { getCurrentIdentity } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CONFERENCE_FLAG, isFeatureEnabled } from "@/lib/features/feature-flags";

export const dynamic = "force-dynamic";

export default async function ConferenceTopicRoute({
  params
}: {
  params: Promise<{ topicId: string }>;
}) {
  if (!(await optionalFeatureEnabled("conference"))) return <LockedFeaturePreview feature="conference" />;

  const [identity, route, enabled] = await Promise.all([
    getCurrentIdentity(),
    params,
    isFeatureEnabled(createSupabaseAdminClient(), CONFERENCE_FLAG)
  ]);
  if (!identity) redirect(`/login?next=/conference/${encodeURIComponent(route.topicId)}`);

  const topic = await loadConferenceTopic(identity.id, route.topicId);
  if (!topic) redirect("/conference?notice=unavailable");
  return <ConferenceTopicPage topic={topic} />;
}
