"use client";

import { MomentMediaViewer } from "@/components/content/moment-media-viewer";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import type { VisibleMoment } from "@/lib/content/service";

/**
 * Full-screen viewer for a message attachment.
 *
 * ONE immersive viewer in Mad Buddy. Rather than building a second full-screen
 * layer for chat, this adapts a message into the shape the existing viewer
 * already consumes, so a photo opened from a group thread behaves exactly like
 * one opened from a Moment: swipe-down to dismiss, Escape and hardware Back to
 * close, focus trapped and restored, page scroll locked underneath.
 *
 * The adapter is deliberately thin and one-directional. The viewer keeps
 * owning presentation; messaging keeps owning its data. Nothing about chat
 * leaks into the Moments component, which is what stops the two diverging the
 * first time either one changes.
 */
export function MessageMediaViewer({
  message,
  open,
  onClose
}: {
  message: ChatMessageView | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!message?.attachment) return null;

  const alt = attachmentAltText(message.senderName, message.isMine);

  /**
   * A message, expressed as the viewer's content shape.
   *
   * Only the fields the viewer actually reads are meaningful; the rest carry
   * neutral values rather than invented ones. Reaction counts are zero and the
   * audience label is null because a chat photo has neither — showing a "0"
   * would imply a reaction affordance that does not exist here.
   */
  const asViewerItem: VisibleMoment = {
    id: message.id,
    authorId: message.senderId ?? "",
    authorName: message.senderName,
    authorAvatarUrl: message.senderAvatarUrl,
    authorPlan: message.senderPlan ?? "free",
    contentType: "photo",
    textContent: null,
    // The caption is the message text, so the viewer's identity layer reads
    // exactly what the thread bubble showed.
    caption: message.text,
    mediaUrl: message.attachment.fullUrl ?? message.attachment.thumbUrl,
    expiresAt: message.createdAt,
    createdAt: message.createdAt,
    myReaction: null,
    reactionCount: 0,
    reactionBreakdown: {},
    isAuthor: message.isMine,
    audienceLabel: null
  } as VisibleMoment;

  return (
    <MomentMediaViewer
      moment={asViewerItem}
      // A single item: chat photos are not a browsable sequence, so the
      // viewer's next/previous affordances stay hidden.
      sequence={[asViewerItem]}
      open={open}
      onClose={onClose}
      fullResUrl={message.attachment.fullUrl ?? null}
      key={`${message.id}-${alt}`}
    />
  );
}
