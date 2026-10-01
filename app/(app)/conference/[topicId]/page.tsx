import { notFound, redirect } from "next/navigation";
import { ConferenceTopicPage } from "@/components/conference/conference-topic-page";
import { loadConferenceTopic } from "@/lib/conference/server";
import { getCurrentIdentity } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function ConferenceTopicRoute({
  params
}: {
  params: Promise<{ topicId: string }>;
}) {
  const [identity, route] = await Promise.all([getCurrentIdentity(), params]);
  if (!identity) redirect(`/login?next=/conference/${encodeURIComponent(route.topicId)}`);

  const topic = await loadConferenceTopic(identity.id, route.topicId);
  if (!topic) notFound();
  return <ConferenceTopicPage topic={topic} />;
}
