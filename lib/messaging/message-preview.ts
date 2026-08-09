import type { MessageType } from "@/lib/supabase/database.types";

export const VOICE_MESSAGE_PREVIEW = "Voice message";

/** One neutral preview rule shared by inboxes, groups and notifications. */
export function messagePreviewText(
  messageType: MessageType | string | null | undefined,
  text: string | null | undefined
): string | null {
  if (messageType === "voice_note") return VOICE_MESSAGE_PREVIEW;
  return text?.trim() || null;
}
