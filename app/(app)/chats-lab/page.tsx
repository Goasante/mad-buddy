import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getConversationsAction, getVoiceRecorderConfigAction } from "@/app/(app)/messaging-actions";
import { MessagesPageV4 } from "@/components/messages/messages-page-v4";
import { getSafetyAdminContext } from "@/lib/safety/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chats Lab",
  robots: { index: false, follow: false }
};

/**
 * Private production-domain proving ground for the next Chats experience.
 *
 * This deliberately lives inside the normal authenticated app shell so PWA
 * sessions, microphone permissions, safe areas and real Supabase behaviour
 * match the app the product owner actually uses. It is not linked from app
 * navigation and it additionally requires the existing admin authorization
 * context. Ordinary users remain on /messages until Chats V4 is approved.
 */
export default async function ChatsLabPage() {
  const admin = await getSafetyAdminContext();
  if (!admin.ok) redirect("/messages");

  const [conversations, voiceRecorderConfig] = await Promise.all([
    getConversationsAction(),
    getVoiceRecorderConfigAction()
  ]);

  return (
    <div className="-mt-[var(--mobile-header-height)] md:mt-0">
      <MessagesPageV4
        initialConversations={conversations}
        voiceRecorderConfig={voiceRecorderConfig}
      />
    </div>
  );
}