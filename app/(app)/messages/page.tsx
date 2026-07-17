import { MessagesPageContent } from "@/components/messages/messages-page";
import { getConversationsAction } from "@/app/(app)/messaging-actions";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const conversations = await getConversationsAction();
  return <MessagesPageContent initialConversations={conversations} />;
}
