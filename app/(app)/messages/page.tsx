import { MessagesPageContent } from "@/components/messages/messages-page";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const [conversations, voiceRecorderConfig] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction()
  ]);
  return <MessagesPageContent initialConversations={conversations} voiceRecorderConfig={voiceRecorderConfig} />;
}
