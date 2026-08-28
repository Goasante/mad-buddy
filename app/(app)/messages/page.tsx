import { MessagesPageV4 } from "@/components/messages/messages-page-v4";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const [conversations, voiceRecorderConfig] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction()
  ]);

  return (
    <div className="-mt-[var(--mobile-header-height)] md:mt-0">
      <MessagesPageV4 initialConversations={conversations} voiceRecorderConfig={voiceRecorderConfig} />
    </div>
  );
}
