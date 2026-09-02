import { MessagesPageV4 } from "@/components/messages/messages-page-v4";
import { MessageDeliveryAck } from "@/components/messages/message-delivery-ack";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";
import { getCurrentUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * Live Messages, now the Chats V4 presentation.
 *
 * ONLY THE PRESENTATION CHANGED. The loaders are the same two canonical
 * actions this route has always used, so the conversation authority, session
 * handling and eligibility rules are untouched -- V4 renders the same
 * ConversationView projection V3 did.
 *
 * MessagesPageV3 is deliberately left in the tree rather than deleted. It is
 * the rollback: reverting this file to import it restores the previous
 * presentation without touching anything else. /chats-lab also stays as the
 * admin-gated comparison surface.
 *
 * Profile's Message action needs no change: it already routes through
 * openDirectConversationAction to /messages?conversation=<id>, so after this
 * cutover the same href opens the V4 conversation.
 */
export default async function MessagesPage() {
  /* `viewerId` scopes the client-side thread cache to this account. It is
     presentation ownership, never authorization: every action below still
     resolves the caller's own identity server-side, and the cache can only
     ever redraw what this viewer was already served. getCurrentUser() is the
     request-cached auth lookup the layout already made, so this costs nothing
     extra. */
  const [conversations, voiceRecorderConfig, user] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction(),
    getCurrentUser()
  ]);

  return (
    <div className="-mt-[var(--mobile-header-height)] md:mt-0">
      <MessageDeliveryAck />
      <MessagesPageV4
        initialConversations={conversations}
        voiceRecorderConfig={voiceRecorderConfig}
        viewerId={user?.id ?? null}
      />
    </div>
  );
}
