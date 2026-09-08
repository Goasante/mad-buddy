"use client";

import { ImageOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshMessageAttachmentAction } from "@/app/(app)/messaging-actions";
import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import { signedUrlNeedsRefresh } from "@/lib/media/signed-url-lifecycle";
import { cn } from "@/lib/utils";

type MessageAttachmentImageProps = {
  conversationId: string;
  message: ChatMessageView;
  onOpen: () => void;
  onRefreshed: (attachment: AttachmentView) => void;
  square?: boolean;
};

/** Canonical private-message image with component-local signed-URL refresh. */
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
  const proactiveRefreshKeyRef = useRef<string | null>(null);

  /*
   * Signed URLs are credentials. Keep an in-flight renewal promise inside this
   * mounted component rather than in module scope: a module-level promise can
   * briefly survive logout/account switching and let the next account reuse a
   * result that was authorised for the previous one. The ref still closes the
   * same-component double-click/onError race synchronously.
   */
  const inFlightRefreshRef = useRef<Promise<AttachmentView | null> | null>(null);

  const attachment = message.attachment;
  const src = attachment?.thumbUrl ?? attachment?.fullUrl ?? null;
  const needsFreshUrl = attachment
    ? signedUrlNeedsRefresh(attachment.expiresAt, Boolean(src))
    : false;
  const alt = attachment ? attachmentAltText(message.senderName, message.isMine) : "";

  const renew = useCallback(async () => {
    if (inFlightRefreshRef.current) return;

    setRefreshing(true);
    const request = refreshMessageAttachmentAction({ conversationId, messageId: message.id })
      .then((result) => (result.ok ? result.attachment ?? null : null))
      .catch(() => null);
    inFlightRefreshRef.current = request;

    try {
      const next = await request;
      if (!next) {
        setFailed(true);
        return;
      }
      attemptedUrlRef.current = null;
      setFailed(false);
      onRefreshed(next);
    } finally {
      if (inFlightRefreshRef.current === request) inFlightRefreshRef.current = null;
      setRefreshing(false);
    }
  }, [conversationId, message.id, onRefreshed]);

  /*
   * Do not deliberately render an expired credential and wait for the browser
   * to show a broken-image glyph. Durable thread storage now removes signed
   * URLs entirely, and an in-memory URL can simply age past its five-minute
   * lifetime. In both cases renew from the canonical media id first.
   */
  useEffect(() => {
    if (!attachment || !needsFreshUrl || failed) return;
    const refreshKey = `${attachment.mediaId}:${attachment.expiresAt}:${src ?? "missing"}`;
    if (proactiveRefreshKeyRef.current === refreshKey) return;
    proactiveRefreshKeyRef.current = refreshKey;
    void renew();
  }, [attachment, failed, needsFreshUrl, renew, src]);

  if (!attachment) return null;

  if (!src || failed || needsFreshUrl) {
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
          {refreshing || (needsFreshUrl && !failed) ? (
            <RotateCcw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ImageOff className="h-5 w-5" aria-hidden="true" />
          )}
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
