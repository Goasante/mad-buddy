import { notFound, redirect } from "next/navigation";
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
  const [identity, route, enabled] = await Promise.all([\n    getCurrentIdentity(),\n    params,\n    isFeatureEnabled(createSupabaseAdminClient(), CONFERENCE_FLAG)\n  ]);
  if (!identity) redirect(`/login?next=/conference/${encodeURIComponent(route.topicId)}`);

  const topic = await loadConferenceTopic(identity.id, route.topicId);
  if (!topic) notFound();
  return <ConferenceTopicPage topic={topic} />;
}
