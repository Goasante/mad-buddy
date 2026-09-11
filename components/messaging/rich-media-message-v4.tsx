"use client";

import { Download, ExternalLink, FileText, Loader2, PlaySquare, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MessageRetentionV4 } from "@/components/messaging/message-retention-v4";
import { getRichMediaMessageViaApi } from "@/lib/messaging/media-upload-client";
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

function videoTypeLabel(contentType: string) {
  if (contentType === "video/mp4") return "MP4";
  if (contentType === "video/webm") return "WebM";
  if (contentType === "video/quicktime") return "MOV";
  return "Video";
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
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    setLoadFailed(false);
    const result = await getRichMediaMessageViaApi({ conversationId, messageId });
    if (!result.ok) {
      setLoadFailed(true);
      return null;
    }
    setMedia(result.media);
    return result.media;
  }, [conversationId, messageId]);

  useEffect(() => {
    let disposed = false;
    void getRichMediaMessageViaApi({ conversationId, messageId }).then((result) => {
      if (disposed) return;
      if (!result.ok) {
        setLoadFailed(true);
        return;
      }
      setMedia(result.media);
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

  if (loadFailed) {
    return (
      <div className="mb-2 w-[min(68vw,300px)] max-w-full">
        <button
          type="button"
          onClick={() => {
            setMedia(undefined);
            void refresh();
          }}
          className="focus-ring flex min-h-20 w-full items-center gap-3 rounded-[18px] border border-current/10 px-3 py-3 text-left text-xs opacity-80 transition active:scale-[.99]"
        >
          <RefreshCw className="h-5 w-5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <strong className="block text-foreground">Attachment didn’t load</strong>
            <span className="mt-0.5 block opacity-70">Tap to try again.</span>
          </span>
        </button>
        <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
      </div>
    );
  }

  if (media === undefined) {
    return (
      <div className="mb-2 grid min-h-24 w-[min(68vw,300px)] max-w-full place-items-center rounded-[18px] bg-black/[0.035] dark:bg-white/[0.05]" role="status" aria-label={`Loading ${kind}`}>
        <Loader2 className="h-5 w-5 animate-spin text-primary motion-reduce:animate-none" />
      </div>
    );
  }

  if (!media) {
    return (
      <div className="mb-2 w-[min(68vw,300px)] max-w-full">
        <div className="flex min-h-20 items-center gap-3 rounded-[18px] border border-current/10 px-3 py-3 text-xs opacity-70">
          {kind === "video" ? <PlaySquare className="h-5 w-5 shrink-0" /> : <FileText className="h-5 w-5 shrink-0" />}
          <span>This attachment is no longer available.</span>
        </div>
        <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
      </div>
    );
  }

  if (media.kind === "video") {
    const videoMeta = [videoTypeLabel(media.contentType), media.sizeBytes > 0 ? formatBytes(media.sizeBytes) : null]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="mb-2 w-fit max-w-full">
        <div className="w-[min(68vw,300px)] max-w-full overflow-hidden rounded-[18px] border border-white/10 bg-black shadow-[0_8px_24px_rgba(78,4,1,0.16)]">
          <video
            controls
            playsInline
            preload="metadata"
            src={media.url}
            className="block max-h-[320px] min-h-[132px] w-full bg-black object-contain"
            aria-label="Video attachment"
            onError={() => {
              if (Date.parse(media.expiresAt) <= Date.now() + 30_000) void refresh();
            }}
          />
          <div className="flex items-center gap-2 border-t border-white/10 bg-[linear-gradient(90deg,rgba(78,4,1,.88),rgba(34,10,7,.94))] px-3 py-2 text-xs text-white/80">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#E88C2B] text-white shadow-[0_3px_8px_rgba(232,140,43,.25)]" aria-hidden="true">
              <PlaySquare className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 font-semibold text-white/90">Video</span>
            {videoMeta ? <span className="shrink-0 text-[11px] text-white/55">{videoMeta}</span> : null}
          </div>
        </div>
        <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
      </div>
    );
  }

  return (
    <div className="mb-2 min-w-0 max-w-full overflow-hidden">
      <div className={`w-[min(78vw,360px)] min-w-0 max-w-full overflow-hidden rounded-2xl border p-3 ${mine ? "border-white/15 bg-white/[0.08]" : "border-black/[0.06] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.04]"}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${mine ? "bg-white/10" : "bg-primary/10 text-primary"}`}>
            <FileText className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 overflow-hidden">
            <strong className="block max-w-full truncate text-xs" title={media.fileName}>{media.fileName}</strong>
            <span className="mt-0.5 block truncate text-xs opacity-65">{fileTypeLabel(media.contentType)}{media.sizeBytes > 0 ? ` · ${formatBytes(media.sizeBytes)}` : ""}</span>
          </span>
        </div>
        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
          <a href={media.url} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-current/15 px-2 text-xs font-semibold transition active:scale-95">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />Open
          </a>
          <a href={media.downloadUrl ?? media.url} className="focus-ring inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-current/15 px-2 text-xs font-semibold transition active:scale-95">
            <Download className="h-3.5 w-3.5 shrink-0" />Save
          </a>
        </div>
      </div>
      <MessageRetentionV4 conversationId={conversationId} messageId={messageId} mine={mine} />
    </div>
  );
}
