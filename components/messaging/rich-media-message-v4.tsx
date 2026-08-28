"use client";

import { Download, ExternalLink, FileText, Loader2, PlaySquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getRichMediaMessageAction } from "@/app/(app)/messaging-rich-media-actions";
import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import type { RichMediaMessageView } from "@/lib/messaging/rich-media-v4-types";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileTypeLabel(contentType: string) {
  if (contentType === "application/pdf") return "PDF";
  if (contentType === "text/plain") return "Text";
  if (contentType.includes("word")) return "Word";
  if (contentType.includes("excel") || contentType.includes("spreadsheet")) return "Excel";
  if (contentType.includes("powerpoint") || contentType.includes("presentation")) return "PowerPoint";
  return "Document";
}

export function RichMediaMessageV4({
  conversationId,
  messageId,
  kind,
  mine
}: {
  conversationId: string;
  messageId: string;
  kind: "video" | "file";
  mine: boolean;
}) {
  const [media, setMedia] = useState<RichMediaMessageView | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await getRichMediaMessageAction({ conversationId, messageId });
    setMedia(next);
    return next;
  }, [conversationId, messageId]);

  useEffect(() => {
    let disposed = false;
    void getRichMediaMessageAction({ conversationId, messageId }).then((next) => {
      if (!disposed) setMedia(next);
    });
    return () => {
      disposed = true;
    };
  }, [conversationId, messageId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !media) return;
      if (Date.parse(media.expiresAt) <= Date.now() + 60_000) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [media, refresh]);

  if (media === undefined) {
    return (
      <div className="mb-2 grid min-h-28 min-w-[220px] place-items-center rounded-2xl bg-black/[0.035] dark:bg-white/[0.05]" role="status" aria-label={`Loading ${kind}`}>
        <Loader2 className="h-5 w-5 animate-spin text-[#E88C2B] motion-reduce:animate-none" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="mb-2 min-w-[220px]">
        <div className="flex min-h-20 items-center gap-3 rounded-2xl border border-current/10 px-3 py-3 text-xs opacity-70">
          {kind === "video" ? <PlaySquare className="h-5 w-5 shrink-0" /> : <FileText className="h-5 w-5 shrink-0" />}
          <span>This attachment is no longer available.</span>
        </div>
        <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
      </div>
    );
  }

  if (media.kind === "video") {
    return (
      <div className="mb-2">
        <div className="overflow-hidden rounded-2xl bg-black shadow-sm">
          <video
            controls
            playsInline
            preload="metadata"
            src={media.url}
            className="block max-h-[420px] min-h-[150px] w-full min-w-[230px] max-w-[440px] bg-black object-contain"
            aria-label={`Video attachment ${media.fileName}`}
            onError={() => {
              if (Date.parse(media.expiresAt) <= Date.now() + 30_000) void refresh();
            }}
          />
          <div className="flex items-center gap-2 bg-black/85 px-3 py-2 text-[10px] text-white/75">
            <PlaySquare className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{media.fileName}</span>
            {media.sizeBytes > 0 ? <span>{formatBytes(media.sizeBytes)}</span> : null}
          </div>
        </div>
        <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
      </div>
    );
  }

  return (
    <div className="mb-2">
      <div className={`min-w-[230px] rounded-2xl border p-3 ${mine ? "border-white/15 bg-white/[0.08]" : "border-black/[0.06] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.04]"}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${mine ? "bg-white/10" : "bg-[#E88C2B]/10 text-[#E88C2B]"}`}>
            <FileText className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-xs">{media.fileName}</strong>
            <span className="mt-0.5 block text-[10px] opacity-65">{fileTypeLabel(media.contentType)}{media.sizeBytes > 0 ? ` · ${formatBytes(media.sizeBytes)}` : ""}</span>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={media.url} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-current/15 px-2 text-[10px] font-bold transition active:scale-95">
            <ExternalLink className="h-3.5 w-3.5" />Open
          </a>
          <a href={media.url} download={media.fileName} className="focus-ring inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-current/15 px-2 text-[10px] font-bold transition active:scale-95">
            <Download className="h-3.5 w-3.5" />Save
          </a>
        </div>
      </div>
      <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
    </div>
  );
}
