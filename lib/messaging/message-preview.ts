import type { MessageType } from "@/lib/supabase/database.types";

export const VOICE_MESSAGE_PREVIEW = "Voice message";

/** One neutral preview rule shared by inboxes, groups and notifications. */
export function messagePreviewText(
  messageType: MessageType | string | null | undefined,
  text: string | null | undefined
): string | null {
  if (messageType === "voice_note") return VOICE_MESSAGE_PREVIEW;
  if (messageType === "image") return text?.trim() || "Photo";
  if (messageType === "video") return text?.trim() || "Video";
  if (messageType === "file") return text?.trim() || "Document";
  if (messageType === "contact") return "Contact";
  if (messageType === "poll") return "Poll";
  if (messageType === "event") return "Event or Plan";
  if (messageType === "place") return "Place";
  if (messageType === "drawing") return text?.trim() || "Drawing";
  return text?.trim() || null;
}
