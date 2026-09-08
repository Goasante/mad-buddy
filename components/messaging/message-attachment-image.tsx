"use client";

import { ImageOff, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshMessageAttachmentAction } from "@/app/(app)/messaging-actions";
import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import { attachmentAltText } from "@/lib/messaging/attachment-labels";
import type { AttachmentView } from "@/lib/messaging/attachments";
import type { ChatMessageView } from "@/lib/messaging/mobile";
import {
  SIGNED_URL_REFRESH_SKEW_MS,
  signedUrlNeedsRefresh
} from "@/lib/media/signed-url-lifecycle";
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
  const refreshingRef = useRef(false);

  /*
   * Signed URLs are credentials. Keep the in-flight renewal map inside this
   * mounted component rather than in module scope: a module-level promise can
   * briefly survive logout/account switching and let the next account reuse a
   * result that was authorised for the previous one. Lazy state initialization
   * creates the Map once without reading or writing a ref during render.
   */
  const [refreshes] = useState(() => {
    const refreshes = new Map<string, Promise<AttachmentView | null>>();
    return refreshes;
  });

  const attachment = message.attachment;
  const src = attachment?.thumbUrl ?? attachment?.fullUrl ?? null;
  const needsFreshUrl = attachment
    ? signedUrlNeedsRefresh(attachment.expiresAt, Boolean(src))
    : false;
  const alt = attachment ? attachmentAltText(message.senderName, message.isMine) : "";

  const refreshAttachment = useCallback((): Promise<AttachmentView | null> => {
    const key = `${conversationId}:${message.id}`;
    const existing = refreshes.get(key);
    if (existing) return existing;

    const request = refreshMessageAttachmentAction({ conversationId, messageId: message.id })
      .then((result) => (result.ok ? result.attachment ?? null : null))
      .catch(() => null)
      .finally(() => refreshes.delete(key));
    refreshes.set(key, request);
    return request;
  }, [conversationId, message.id, refreshes]);

  const renew = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);

    try {
      const next = await refreshAttachment();
      if (!next) {
        setFailed(true);
        return;
      }
      attemptedUrlRef.current = null;
      setFailed(false);
      onRefreshed(next);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [onRefreshed, refreshAttachment]);

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

  /*
   * `needsFreshUrl` is evaluated during render, so a conversation that stays
   * mounted for longer than the five-minute Storage TTL needs its own wake-up.
   * Schedule renewal just before expiry while the credential is still usable.
   * This also keeps the full-resolution URL fresh for somebody who opens the
   * immersive viewer after leaving the thread on screen for several minutes.
   * The timer is component-local and cleared on unmount/account navigation.
   */
  useEffect(() => {
    if (!attachment || !src || failed || needsFreshUrl) return;

    const expiresMs = Date.parse(attachment.expiresAt);
    if (!Number.isFinite(expiresMs)) return;
    const delayMs = Math.max(0, expiresMs - Date.now() - SIGNED_URL_REFRESH_SKEW_MS);
    const timer = window.setTimeout(() => {
      proactiveRefreshKeyRef.current = `${attachment.mediaId}:${attachment.expiresAt}:${src}`;
      void renew();
    }, delayMs);

    return () => window.clearTimeout(timer);
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
