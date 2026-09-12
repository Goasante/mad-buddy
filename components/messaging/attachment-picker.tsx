"use client";

import { CalendarDays, Camera, FileText, Image as ImageIcon, ImagePlus, Plus, RotateCcw, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { discardMessageAttachmentAction } from "@/app/(app)/messaging-actions";
import { AppMenu } from "@/components/ui/app-dropdown";
import { StructuredShareV4, type StructuredShareMode } from "@/components/messaging/structured-share-v4";
import { uploadMediaToSignedUrlWithProgress } from "@/lib/media/signed-upload-progress";
import { validateImageSelection } from "@/lib/media/validation";
import {
  createImageUploadIntentViaApi as createMessageAttachmentUploadIntentAction,
  createRichMediaUploadIntentViaApi as createChatRichMediaUploadIntentAction,
  finalizeImageUploadViaApi as finalizeMessageAttachmentUploadAction,
  finalizeRichMediaUploadViaApi as finalizeChatRichMediaUploadAction
} from "@/lib/messaging/media-upload-client";
import { cn } from "@/lib/utils";

export type SelectedAttachment = {
  mediaId: string;
  previewUrl: string | null;
  kind?: "image" | "video" | "file";
  fileName?: string | null;
  sizeBytes?: number | null;
};

export function discardAttachment(attachment: SelectedAttachment | null): void {
  if (!attachment) return;
  void discardMessageAttachmentAction(attachment.mediaId);
}

export type AttachmentUploadLifecycle =
  | "idle"
  | "selected"
  | "uploading"
  | "processing"
  | "ready"
  | "sending"
  | "failed";

type UploadState =
  | { status: Exclude<AttachmentUploadLifecycle, "failed"> }
  | { status: "failed"; message: string };

type UploadIntent = {
  mediaId: string;
  path: string;
  token: string;
};

type RichKind = "video" | "file";
type RetryUpload = {
  file: File;
  kind: "image" | RichKind;
  index: number;
  total: number;
} | null;

type UploadProgressState = {
  percent: number;
  fileName: string;
  index: number;
  total: number;
};

const MAX_RICH_BYTES = 15 * 1024 * 1024;
const MAX_FILES_PER_SELECTION = 10;
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const DOCUMENT_MIMES = new Set([
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "txt", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function validateRichSelection(file: File, kind: RichKind) {
  if (!Number.isFinite(file.size) || file.size <= 0) return kind === "video" ? "Choose a video first." : "Choose a document first.";
  if (file.size > MAX_RICH_BYTES) return "Use a file smaller than 15 MB.";
  const ext = fileExtension(file.name);
  if (kind === "video") {
    if (!VIDEO_MIMES.has(file.type) && !VIDEO_EXTENSIONS.has(ext)) return "Choose an MP4, WebM, or MOV video.";
    return null;
  }
  if (!DOCUMENT_MIMES.has(file.type) && !DOCUMENT_EXTENSIONS.has(ext)) {
    return "Choose a PDF, text, Word, Excel, or PowerPoint document.";
  }
  return null;
}

function UploadProgressGlyph({ percent, processing }: { percent: number; processing: boolean }) {
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span className="relative grid h-8 w-8 place-items-center text-primary" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="absolute inset-0 h-8 w-8 -rotate-90" fill="none">
        <circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="2.5" opacity="0.18" />
        <circle
          cx="12"
          cy="12"
          r={radius}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className="relative text-[8px] font-bold tabular-nums">{processing ? "✓" : clamped}</span>
    </span>
  );
}

export function AttachmentPicker({
  conversationId,
  onAttachmentChange,
  onLifecycleChange,
  onFeedback,
  onStructuredSent,
  disabled = false
}: {
  conversationId: string;
  onAttachmentChange: (next: SelectedAttachment | null) => void;
  onLifecycleChange?: (state: AttachmentUploadLifecycle) => void;
  onFeedback?: (message: string) => void;
  onStructuredSent?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [progress, setProgress] = useState<UploadProgressState | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [structuredShareMode, setStructuredShareMode] = useState<StructuredShareMode | null>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const retryRef = useRef<RetryUpload>(null);
  const photoQueueRef = useRef<Array<{ file: File; index: number; total: number }>>([]);
  const richQueueRef = useRef<Array<{ file: File; kind: RichKind; index: number; total: number }>>([]);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);

  function transition(next: UploadState) {
    setState(next);
    onLifecycleChange?.(next.status);
    // The failure reason previously only reached an sr-only span next to the
    // tiny retry icon, so a rejected upload (e.g. a video over the size cap)
    // looked identical to one silently stuck. Route it through the same
    // visible feedback banner every other composer error already uses.
    if (next.status === "failed") onFeedback?.(next.message);
  }

  function clearCurrentIntent(discard = false) {
    const intent = intentRef.current;
    if (discard && intent) void discardMessageAttachmentAction(intent.mediaId);
    intentRef.current = null;
  }

  function clearQueues() {
    photoQueueRef.current = [];
    richQueueRef.current = [];
  }

  function beginProgress(file: File, index: number, total: number) {
    setProgress({ percent: 0, fileName: file.name, index, total });
  }

  function updateProgress(percent: number) {
    setProgress((current) => (current ? { ...current, percent } : current));
  }

  function finishAllUploads() {
    retryRef.current = null;
    setRetryAvailable(false);
    setProgress(null);
    transition({ status: "ready" });
  }

  useEffect(() => {
    return () => {
      const intent = intentRef.current;
      if (intent) void discardMessageAttachmentAction(intent.mediaId);
    };
  }, []);

  function cancelFailedUpload() {
    clearCurrentIntent(true);
    clearQueues();
    retryRef.current = null;
    setRetryAvailable(false);
    setProgress(null);
    transition({ status: "idle" });
  }

  async function uploadImage(file: File, index: number, total: number) {
    const selectionError = validateImageSelection(file, "chat");
    if (selectionError) {
      clearQueues();
      transition({ status: "failed", message: selectionError });
      return;
    }

    clearCurrentIntent(true);
    retryRef.current = { file, kind: "image", index, total };
    setRetryAvailable(true);
    beginProgress(file, index, total);
    transition({ status: "selected" });
    transition({ status: "uploading" });

    const created = await createMessageAttachmentUploadIntentAction({
      conversationId,
      contentType: file.type,
      sizeBytes: file.size
    });
    if (!created.ok || !created.mediaId || !created.path || !created.token) {
      clearQueues();
      transition({ status: "failed", message: created.message });
      return;
    }

    const intent = { mediaId: created.mediaId, path: created.path, token: created.token };
    intentRef.current = intent;
    try {
      await uploadMediaToSignedUrlWithProgress({
        path: intent.path,
        token: intent.token,
        file,
        contentType: file.type,
        upsert: true,
        onProgress: ({ percent }) => updateProgress(percent)
      });
    } catch {
      clearCurrentIntent(true);
      clearQueues();
      transition({ status: "failed", message: "Couldn't upload that photo. Try again." });
      return;
    }

    updateProgress(100);
    transition({ status: "processing" });
    const result = await finalizeMessageAttachmentUploadAction({ conversationId, mediaId: intent.mediaId });
    if (!result.ok || !result.mediaId) {
      clearCurrentIntent(true);
      clearQueues();
      transition({ status: "failed", message: result.message });
      return;
    }

    clearCurrentIntent();
    onAttachmentChange({
      mediaId: result.mediaId,
      previewUrl: result.previewUrl ?? null,
      kind: "image",
      fileName: file.name,
      sizeBytes: file.size
    });

    const next = photoQueueRef.current.shift();
    if (next) {
      void uploadImage(next.file, next.index, next.total);
      return;
    }
    finishAllUploads();
  }

  function uploadImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    cancelFailedUpload();
    const chosen = Array.from(files).slice(0, MAX_FILES_PER_SELECTION);
    if (files.length > MAX_FILES_PER_SELECTION) onFeedback?.(`Sending the first ${MAX_FILES_PER_SELECTION} photos.`);
    const total = chosen.length;
    photoQueueRef.current = chosen.slice(1).map((file, offset) => ({ file, index: offset + 2, total }));
    void uploadImage(chosen[0]!, 1, total);
  }

  async function uploadRich(file: File, kind: RichKind, index: number, total: number) {
    const selectionError = validateRichSelection(file, kind);
    if (selectionError) {
      clearQueues();
      transition({ status: "failed", message: selectionError });
      return;
    }

    clearCurrentIntent(true);
    retryRef.current = { file, kind, index, total };
    setRetryAvailable(true);
    beginProgress(file, index, total);
    transition({ status: "selected" });
    transition({ status: "uploading" });

    const created = await createChatRichMediaUploadIntentAction({
      conversationId,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      mediaKind: kind,
      fileName: file.name
    });
    if (!created.ok) {
      clearQueues();
      transition({ status: "failed", message: created.message });
      return;
    }

    const intent = created.intent;
    intentRef.current = { mediaId: intent.mediaId, path: intent.path, token: intent.token };
    try {
      await uploadMediaToSignedUrlWithProgress({
        path: intent.path,
        token: intent.token,
        file,
        contentType: intent.contentType || file.type || "application/octet-stream",
        upsert: false,
        onProgress: ({ percent }) => updateProgress(percent)
      });
    } catch {
      clearCurrentIntent(true);
      clearQueues();
      transition({
        status: "failed",
        message: kind === "video" ? "Couldn't upload that video. Try again." : `Couldn't upload ${file.name}. Try again.`
      });
      return;
    }

    updateProgress(100);
    transition({ status: "processing" });
    const finalized = await finalizeChatRichMediaUploadAction({
      conversationId,
      mediaId: intent.mediaId,
      expectedMediaKind: kind
    });
    if (!finalized.ok || !finalized.mediaId || !finalized.mediaKind) {
      clearCurrentIntent(true);
      clearQueues();
      transition({ status: "failed", message: finalized.message });
      return;
    }

    clearCurrentIntent();
    onAttachmentChange({
      mediaId: finalized.mediaId,
      previewUrl: null,
      kind: finalized.mediaKind,
      fileName: finalized.fileName || file.name,
      sizeBytes: finalized.sizeBytes
    });

    const next = richQueueRef.current.shift();
    if (next) {
      void uploadRich(next.file, next.kind, next.index, next.total);
      return;
    }
    finishAllUploads();
  }

  function uploadDocuments(files: FileList | null) {
    if (!files || files.length === 0) return;
    cancelFailedUpload();
    const chosen = Array.from(files).slice(0, MAX_FILES_PER_SELECTION);
    if (files.length > MAX_FILES_PER_SELECTION) onFeedback?.(`Sending the first ${MAX_FILES_PER_SELECTION} documents.`);
    const total = chosen.length;
    richQueueRef.current = chosen.slice(1).map((file, offset) => ({ file, kind: "file" as const, index: offset + 2, total }));
    void uploadRich(chosen[0]!, "file", 1, total);
  }

  function uploadVideo(file: File | undefined) {
    if (!file) return;
    cancelFailedUpload();
    void uploadRich(file, "video", 1, 1);
  }

  function retry() {
    const current = retryRef.current;
    if (!current) return;
    if (current.kind === "image") void uploadImage(current.file, current.index, current.total);
    else void uploadRich(current.file, current.kind, current.index, current.total);
  }

  const busy = disabled || state.status === "selected" || state.status === "uploading" || state.status === "processing";
  const progressLabel = progress
    ? `${state.status === "processing" ? "Verifying" : "Uploading"} ${progress.fileName}${progress.total > 1 ? `, ${progress.index} of ${progress.total}` : ""}, ${progress.percent} percent`
    : "Add an attachment";

  return (
    <>
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          uploadImages(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            cancelFailedUpload();
            void uploadImage(file, 1, 1);
          }
          event.target.value = "";
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.m4v,.mov"
        className="hidden"
        onChange={(event) => {
          uploadVideo(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={documentRef}
        type="file"
        multiple
        accept="application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        className="hidden"
        onChange={(event) => {
          uploadDocuments(event.target.files);
          event.target.value = "";
        }}
      />

      <AppMenu
        label="Add an attachment"
        side="top"
        align="start"
        items={[
          {
            id: "camera",
            label: "Camera",
            description: "Take a photo now",
            icon: <Camera className="h-4.5 w-4.5" />,
            onSelect: () => cameraRef.current?.click(),
            disabled: busy
          },
          {
            id: "library",
            label: "Photos",
            description: "Choose up to 10 photos",
            icon: <ImageIcon className="h-4.5 w-4.5" />,
            onSelect: () => libraryRef.current?.click(),
            disabled: busy
          },
          {
            id: "video",
            label: "Video",
            description: "MP4, WebM or MOV · up to 15 MB",
            icon: <Video className="h-4.5 w-4.5" />,
            onSelect: () => videoRef.current?.click(),
            disabled: busy,
            separatorBefore: true
          },
          {
            id: "document",
            label: "Documents",
            description: "Choose up to 10 PDF, Word, Excel, PowerPoint or text files",
            icon: <FileText className="h-4.5 w-4.5" />,
            onSelect: () => documentRef.current?.click(),
            disabled: busy
          },
          ...(onFeedback && onStructuredSent
            ? [
                {
                  id: "agenda",
                  label: "Plan / Event",
                  description: "Share something from your upcoming agenda",
                  icon: <CalendarDays className="h-4.5 w-4.5" />,
                  onSelect: () => setStructuredShareMode("agenda" as const),
                  disabled: busy,
                  separatorBefore: true
                }
              ]
            : [])
        ]}
        trigger={
          <button
            type="button"
            aria-label="Add an attachment"
            title={progressLabel}
            disabled={busy}
            className={cn(
              "focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full",
              "text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-80"
            )}
          >
            {progress && (state.status === "uploading" || state.status === "processing") ? (
              <UploadProgressGlyph percent={progress.percent} processing={state.status === "processing"} />
            ) : (
              <Plus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        }
      />
      {structuredShareMode && onFeedback && onStructuredSent ? (
        <StructuredShareV4
          conversationId={conversationId}
          open
          mode={structuredShareMode}
          onOpenChange={(next) => { if (!next) setStructuredShareMode(null); }}
          onFeedback={onFeedback}
          onSent={onStructuredSent}
        />
      ) : null}
      {progress && (state.status === "uploading" || state.status === "processing") ? (
        <span className="sr-only" role="status" aria-live="polite">{progressLabel}</span>
      ) : null}
      {state.status === "failed" ? (
        <div className="flex items-center gap-1" role="alert">
          <span className="sr-only">{state.message}</span>
          {retryAvailable ? (
            <button type="button" onClick={retry} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60" aria-label="Retry attachment upload" title="Retry attachment upload">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" onClick={cancelFailedUpload} className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60" aria-label="Cancel attachment upload" title="Cancel attachment upload">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

export function AttachmentPreview({
  attachment,
  onRemove,
  uploadError
}: {
  attachment: SelectedAttachment | null;
  onRemove: () => void;
  uploadError?: string | null;
}) {
  if (!attachment && !uploadError) return null;

  const kind = attachment?.kind ?? "image";
  const label = kind === "video" ? "Video ready. Add a caption or send." : kind === "file" ? "Document ready. Add a message or send." : "Photo ready. Add a caption or send.";
  const displayName = kind === "video" ? "Video" : attachment?.fileName;

  return (
    <div className="flex items-center gap-3 border-t border-border/70 px-3 py-2" aria-live="polite">
      {attachment ? (
        <>
          <div className="relative">
            {kind === "image" && attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
              <img src={attachment.previewUrl} alt="Photo ready to send" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-xl bg-secondary" aria-hidden="true">
                {kind === "video" ? <Video className="h-5 w-5 text-[#E88C2B]" /> : kind === "file" ? <FileText className="h-5 w-5 text-[#E88C2B]" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
            )}
            <button type="button" onClick={onRemove} aria-label={kind === "file" ? "Remove document" : kind === "video" ? "Remove video" : "Remove photo"} className="focus-ring absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            {displayName ? <strong className="block truncate text-xs">{displayName}</strong> : null}
            <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
          </div>
        </>
      ) : (
        <p className="text-xs text-destructive" role="alert">{uploadError}</p>
      )}
    </div>
  );
}
