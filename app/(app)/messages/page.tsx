import { MessagesPageV4 } from "@/components/messages/messages-page-v4";
import { MessageDeliveryAck } from "@/components/messages/message-delivery-ack";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";
import { getCurrentIdentity } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Live Messages has one owner for conversations, favorites and threads.
 */
export default async function MessagesPage() {
  /* getCurrentIdentity is request-cached by the authed layout. The profile
     read is deliberately narrow: only the two identity fields shown in the
     Messages shortcut header. No private profile data is projected client-side. */
  const user = await getCurrentIdentity();
  const supabase = await createSupabaseServerClient();

  const [conversations, voiceRecorderConfig, profileResult] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction(),
    user
      ? supabase
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  return (
    <div className="-mt-[var(--mobile-header-height)] h-[calc(100dvh-var(--mobile-bottom-nav-height,0px))] min-h-0 md:mt-0 md:h-auto">
      <MessageDeliveryAck />
      <MessagesPageV4
        key={user?.id ?? "signed-out"}
        initialConversations={conversations}
        voiceRecorderConfig={voiceRecorderConfig}
        viewerId={user?.id ?? null}
        viewerDisplayName={profileResult.data?.full_name?.split(/\s+/)[0] || "You"}
        viewerAvatarUrl={profileResult.data?.avatar_url ?? null}
      />
    </div>
  );
}
