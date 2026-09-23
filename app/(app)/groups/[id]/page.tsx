import { notFound, redirect } from "next/navigation";

import { loadGroupDetailAction } from "@/app/(app)/group-actions";
import { getMessagesAction } from "@/app/(app)/messaging-actions";
import { GroupDetailPageV2 } from "@/components/groups/group-detail-page-v2";

/**
 * Legacy Group deep link.
 *
 * Group CHAT always belongs to Messages. The only surviving use of this route
 * is an explicit `?details=1` management sub-screen opened from Group Settings;
 * an old bookmark or notification without that flag goes straight to the
 * canonical Messages conversation.
 */
export default async function GroupDetailRoute({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ details?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (query.details !== "1") {
    redirect(`/messages?conversation=${encodeURIComponent(id)}`);
  }

  const [group, messages] = await Promise.all([
    loadGroupDetailAction(id),
    getMessagesAction(id)
  ]);
  if (!group) notFound();

  return <GroupDetailPageV2 group={group} initialMessages={messages} />;
}
