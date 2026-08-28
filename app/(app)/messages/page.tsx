import { MessagesPageV2 } from "@/components/messages/messages-page-v2";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const [conversations, voiceRecorderConfig] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction()
  ]);
  return <MessagesPageV2 initialConversations={conversations} voiceRecorderConfig={voiceRecorderConfig} />;
}
