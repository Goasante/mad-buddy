import { MessagesExperienceV5 } from "@/components/messages/messages-experience-v5";
import { MessageDeliveryAck } from "@/components/messages/message-delivery-ack";
import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";
import { getCurrentIdentity } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Live Messages, with the V5 inbox shell around the canonical Chats V4 thread.
 *
 * The underlying messaging authority is unchanged: conversations, messages,
 * drafts, presence, polls, reactions, media and delivery still come from the
 * same V4 actions/services. V5 is the presentation layer requested in the
 * product review — quick profile/notifications, favorites and a stronger
 * composer treatment — so it can evolve without forking message logic.
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
      <MessagesExperienceV5
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
