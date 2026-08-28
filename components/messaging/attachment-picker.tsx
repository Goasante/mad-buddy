"use client";

import { Camera, FileText, Image as ImageIcon, ImagePlus, Loader2, Plus, RotateCcw, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createMessageAttachmentUploadIntentAction,
  discardMessageAttachmentAction,
  finalizeMessageAttachmentUploadAction
} from "@/app/(app)/messaging-actions";
import {
  createChatRichMediaUploadIntentAction,
  finalizeChatRichMediaUploadAction
} from "@/app/(app)/messaging-rich-media-actions";
import { AppMenu } from "@/components/ui/app-dropdown";
import { validateImageSelection } from "@/lib/media/validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The canonical composer attachment control.
 *
 * Shared by every conversation surface — group chats, direct messages, plan
 * and event chats — because it takes only a conversation id. Nothing here
 * knows which kind of conversation it is attached to, which is what stops a
 * second attachment UI appearing when another surface needs one.
 *
 * Photos, videos and documents all use private storage + server-issued signed
 * upload intents. The server re-downloads and verifies bytes before a READY
 * asset may enter the canonical message send pipeline.
 */

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
type RichRetry = { file: File; kind: RichKind } | null;

const MAX_RICH_BYTES = 15 * 1024 * 1024;
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

export function AttachmentPicker({
  conversationId,
  onAttachmentChange,
  onLifecycleChange,
  disabled = false
}: {
  conversationId: string;
  onAttachmentChange: (next: SelectedAttachment | null) => void;
  onLifecycleChange?: (state: AttachmentUploadLifecycle) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const fileRef = useRef<File | null>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const uploadedRef = useRef(false);
  const richRetryRef = useRef<RichRetry>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);

  function transition(next: UploadState) {
    setState(next);
    onLifecycleChange?.(next.status);
  }

  useEffect(() => {
    return () => {
      const intent = intentRef.current;
      if (intent) void discardMessageAttachmentAction(intent.mediaId);
    };
  }, []);

  function cancelFailedUpload() {
    const intent = intentRef.current;
    if (intent) void discardMessageAttachmentAction(intent.mediaId);
    intentRef.current = null;
    uploadedRef.current = false;
    fileRef.current = null;
    richRetryRef.current = null;
    setRetryAvailable(false);
    transition({ status: "idle" });
  }

  async function continueImageUpload() {
    const file = fileRef.current;
    if (!file) return;

    transition({ status: "uploading" });
    let intent = intentRef.current;
    if (!intent) {
      const created = await createMessageAttachmentUploadIntentAction({
        conversationId,
        contentType: file.type,
        sizeBytes: file.size
      });
      if (!created.ok || !created.mediaId || !created.path || !created.token) {
        transition({ status: "failed", message: created.message });
        return;
      }
      intent = { mediaId: created.mediaId, path: created.path, token: created.token };
      intentRef.current = intent;
    }

    if (!uploadedRef.current) {
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.storage
          .from("media")
          .uploadToSignedUrl(intent.path, intent.token, file, {
            contentType: file.type,
            upsert: true
          });
        if (error) throw error;
        uploadedRef.current = true;
      } catch {
        void discardMessageAttachmentAction(intent.mediaId);
        intentRef.current = null;
        uploadedRef.current = false;
        transition({ status: "failed", message: "Couldn't upload that photo. Try again." });
        return;
      }
    }

    transition({ status: "processing" });
    const result = await finalizeMessageAttachmentUploadAction({
      conversationId,
      mediaId: intent.mediaId
    });
    if (!result.ok || !result.mediaId) {
      transition({ status: "failed", message: result.message });
      return;
    }

    intentRef.current = null;
    uploadedRef.current = false;
    fileRef.current = null;
    richRetryRef.current = null;
    setRetryAvailable(false);
    transition({ status: "ready" });
    onAttachmentChange({ mediaId: result.mediaId, previewUrl: result.previewUrl ?? null, kind: "image", fileName: file.name, sizeBytes: file.size });
  }

  function uploadImage(file: File | undefined) {
    if (!file) return;
    const selectionError = validateImageSelection(file, "chat");
    if (selectionError) {
      transition({ status: "failed", message: selectionError });
      return;
    }
    cancelFailedUpload();
    fileRef.current = file;
    setRetryAvailable(true);
    transition({ status: "selected" });
    void continueImageUpload();
  }

  async function uploadRich(file: File, kind: RichKind) {
    const selectionError = validateRichSelection(file, kind);
    if (selectionError) {
      transition({ status: "failed", message: selectionError });
      return;
    }

    cancelFailedUpload();
    richRetryRef.current = { file, kind };
    setRetryAvailable(true);
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
      transition({ status: "failed", message: created.message });
      return;
    }

    const intent = created.intent;
    intentRef.current = { mediaId: intent.mediaId, path: intent.path, token: intent.token };
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(intent.path, intent.token, file, {
          contentType: intent.contentType,
          upsert: false
        });
      if (error) throw error;
    } catch {
      void discardMessageAttachmentAction(intent.mediaId);
      intentRef.current = null;
      transition({ status: "failed", message: kind === "video" ? "Couldn't upload that video. Try again." : "Couldn't upload that document. Try again." });
      return;
    }

    transition({ status: "processing" });
    const finalized = await finalizeChatRichMediaUploadAction({
      conversationId,
      mediaId: intent.mediaId,
      expectedMediaKind: kind
    });
    if (!finalized.ok) {
      intentRef.current = null;
      transition({ status: "failed", message: finalized.message });
      return;
    }

    intentRef.current = null;
    richRetryRef.current = null;
    setRetryAvailable(false);
    transition({ status: "ready" });
    onAttachmentChange({
      mediaId: finalized.mediaId,
      previewUrl: null,
      kind: finalized.mediaKind,
      fileName: finalized.fileName,
      sizeBytes: finalized.sizeBytes
    });
  }

  function retry() {
    const rich = richRetryRef.current;
    if (rich) {
      void uploadRich(rich.file, rich.kind);
      return;
    }
    void continueImageUpload();
  }

  const busy = disabled || state.status === "selected" || state.status === "uploading" || state.status === "processing";

  return (
    <>
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          uploadImage(event.target.files?.[0]);
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
          uploadImage(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.m4v,.mov"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadRich(file, "video");
          event.target.value = "";
        }}
      />
      <input
        ref={documentRef}
        type="file"
        accept="application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadRich(file, "file");
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
            description: "Choose from your photo library",
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
            label: "Document",
            description: "PDF, text, Word, Excel or PowerPoint",
            icon: <FileText className="h-4.5 w-4.5" />,
            onSelect: () => documentRef.current?.click(),
            disabled: busy
          }
        ]}
        trigger={
          <button
            type="button"
            aria-label="Add an attachment"
            disabled={busy}
            className={cn(
              "focus-ring safe-motion grid h-11 w-11 shrink-0 place-items-center rounded-full",
              "text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50"
            )}
          >
            {state.status === "uploading" || state.status === "processing" ? (
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Plus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        }
      />
      {state.status === "processing" ? <span className="sr-only" role="status">Verifying attachment</span> : null}
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
            {kind === "image" ? (
              <button type="button" onClick={onRemove} aria-label="Remove photo" className="focus-ring absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button type="button" onClick={onRemove} aria-label={kind === "file" ? "Remove document" : "Remove video"} className="focus-ring absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {attachment.fileName ? <strong className="block truncate text-xs">{attachment.fileName}</strong> : null}
            <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
          </div>
        </>
      ) : (
        <p className="text-xs text-destructive" role="alert">{uploadError}</p>
      )}
    </div>
  );
}