import { MessagesPageV3 } from "@/components/messages/messages-page-v3";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const [conversations, voiceRecorderConfig] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction()
  ]);
  return <MessagesPageV3 initialConversations={conversations} voiceRecorderConfig={voiceRecorderConfig} />;
}
