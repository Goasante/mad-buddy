import { notFound } from "next/navigation";
import { getMessagesAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";
import { loadGroupDetailAction } from "@/app/(app)/group-actions";
import { GroupDetailPage } from "@/components/groups/group-detail-page";

export default async function GroupDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await loadGroupDetailAction(id);

  if (!group) {
    notFound();
  }

  const [messages, voiceRecorderConfig] = await Promise.all([
    getMessagesAction(id),
    getVoiceRecorderConfigAction()
  ]);
  return <GroupDetailPage group={group} initialMessages={messages} voiceRecorderConfig={voiceRecorderConfig} />;
}