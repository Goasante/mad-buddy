import { notFound } from "next/navigation";
import { getMessagesAction } from "@/app/(app)/messaging-actions";
import { loadGroupDetailAction } from "@/app/(app)/group-actions";
import { GroupDetailPage } from "@/components/groups/group-detail-page";

export default async function GroupDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await loadGroupDetailAction(id);

  if (!group) {
    notFound();
  }

  const messages = await getMessagesAction(id);
  return <GroupDetailPage group={group} initialMessages={messages} />;
}
