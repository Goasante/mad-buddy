"use client";

import { ImageOff, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import { refreshMessageAttachmentAction } from "@/app/(app)/messaging-actions";
import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import { cn } from "@/lib/utils";

const refreshes = new Map<string, Promise<AttachmentView | null>>();

function refreshAttachment(conversationId: string, messageId: string): Promise<AttachmentView | null> {
  const key = `${conversationId}:${messageId}`;
  const existing = refreshes.get(key);
  if (existing) return existing;

  const request = refreshMessageAttachmentAction({ conversationId, messageId })
    .then((result) => (result.ok ? result.attachment ?? null : null))
    .catch(() => null)
    .finally(() => refreshes.delete(key));
  refreshes.set(key, request);
  return request;
}

type MessageAttachmentImageProps = {
  conversationId: string;
  message: ChatMessageView;
  onOpen: () => void;
  onRefreshed: (attachment: AttachmentView) => void;
  square?: boolean;
};

/** Canonical private-message image with deduplicated signed-URL refresh. */
export function MessageAttachmentImage({
  conversationId,
  message,
  onOpen,
  onRefreshed,
  square = false
}: MessageAttachmentImageProps) {
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const attemptedUrlRef = useRef<string | null>(null);
  const attachment = message.attachment;
  if (!attachment) return null;

  const src = attachment.thumbUrl ?? attachment.fullUrl;
  const alt = attachmentAltText(message.senderName, message.isMine);

  async function renew() {
    if (refreshing) return;
    setRefreshing(true);
    const next = await refreshAttachment(conversationId, message.id);
    setRefreshing(false);
    if (!next) {
      setFailed(true);
      return;
    }
    attemptedUrlRef.current = null;
    setFailed(false);
    onRefreshed(next);
  }

  if (!src || failed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => void renew()}
          className={cn(
            "focus-ring grid place-items-center rounded-xl bg-secondary/70 text-muted-foreground",
            square ? "aspect-square w-full" : "h-28 w-44"
          )}
          aria-label="Retry loading photo"
        >
          {refreshing ? <RotateCcw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ImageOff className="h-5 w-5" aria-hidden="true" />}
        </button>
        {!square ? <MessageRetentionV4 conversationId={conversationId} messageId={message.id} mine={message.isMine} /> : null}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={alt}
        className={cn(
          "focus-ring safe-motion block overflow-hidden rounded-xl",
          square ? "aspect-square w-full" : "-mx-1 mb-1"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived private signed URL */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          width={attachment.width ?? undefined}
          height={attachment.height ?? undefined}
          className={square ? "h-full w-full object-cover" : "max-h-64 w-full max-w-[15rem] object-cover"}
          onError={() => {
            if (attemptedUrlRef.current === src) {
              setFailed(true);
              return;
            }
            attemptedUrlRef.current = src;
            void renew();
          }}
        />
      </button>
      {!square ? <MessageRetentionV4 conversationId={conversationId} messageId={message.id} mine={message.isMine} /> : null}
    </div>
  );
}
