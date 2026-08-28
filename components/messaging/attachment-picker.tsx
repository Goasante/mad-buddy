"use client";

import { Camera, FileText, Image as ImageIcon, ImagePlus, Loader2, Plus, RotateCcw, UserRound, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  createMessageAttachmentUploadIntentAction,
  discardMessageAttachmentAction,
  finalizeMessageAttachmentUploadAction
} from "@/app/(app)/messaging-actions";
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
 * second attachment UI appearing the first time another surface needs one.
 *
 * The durable upload pipeline is still IMAGES ONLY today. The product menu,
 * however, deliberately shows the approved future architecture instead of
 * making those capabilities look forgotten. Unsupported types are labelled
 * "Later" and disabled; they never pretend to upload or silently drop data.
 */

export type SelectedAttachment = {
  mediaId: string;
  previewUrl: string | null;
};

/**
 * Drop an attachment the sender chose not to send.
 *
 * Exported so every composer clears an attachment the same way. Without the
 * server call, cancelling a photo would leave a ready `media_assets` row and
 * its stored objects behind forever — an orphan nobody can see and no job
 * collects.
 *
 * Fire-and-forget: the local state must clear instantly whatever the network
 * does, and the action is idempotent, so a lost request is harmless.
 */
export function discardAttachment(attachment: SelectedAttachment | null): void {
  if (!attachment) return;
  void discardMessageAttachmentAction(attachment.mediaId);
}

/** The upload lifecycle, as an explicit state rather than scattered booleans. */
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
  const [retryAvailable, setRetryAvailable] = useState(false);
  // Two inputs, because `capture` is what makes the second one open the
  // camera directly rather than the gallery.
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

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
    setRetryAvailable(false);
    transition({ status: "idle" });
  }

  async function continueUpload() {
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
    setRetryAvailable(false);
    transition({ status: "ready" });
    onAttachmentChange({ mediaId: result.mediaId, previewUrl: result.previewUrl ?? null });
  }

  function upload(file: File | undefined) {
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
    void continueUpload();
  }

  const busy = disabled || state.status === "selected" || state.status === "uploading" || state.status === "processing";

  return (
    <>
      {/* Hidden pickers. `accept` is narrowed to exactly what the pipeline
          validates, so the OS sheet cannot offer an unsupported type. */}
      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          upload(event.target.files?.[0]);
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
          upload(event.target.files?.[0]);
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
            label: "Video · Later",
            description: "Kept in the product architecture; upload support comes next",
            icon: <Video className="h-4.5 w-4.5" />,
            onSelect: () => undefined,
            disabled: true,
            separatorBefore: true
          },
          {
            id: "document",
            label: "Document · Later",
            description: "Durable file messages need their own verified storage contract",
            icon: <FileText className="h-4.5 w-4.5" />,
            onSelect: () => undefined,
            disabled: true
          },
          {
            id: "contact",
            label: "Contact · Later",
            description: "Structured contact sharing will be added without exposing hidden fields",
            icon: <UserRound className="h-4.5 w-4.5" />,
            onSelect: () => undefined,
            disabled: true
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
            {state.status === "uploading" ? (
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Plus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        }
      />
      {state.status === "processing" ? (
        <span className="sr-only" role="status">Preparing photo</span>
      ) : null}
      {state.status === "failed" ? (
        <div className="flex items-center gap-1" role="alert">
          <span className="sr-only">{state.message}</span>
          {retryAvailable ? (
            <button
              type="button"
              onClick={() => void continueUpload()}
              className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60"
              aria-label="Retry photo upload"
              title="Retry photo upload"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={cancelFailedUpload}
            className="focus-ring grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-secondary/60"
            aria-label="Cancel photo upload"
            title="Cancel photo upload"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * The pre-send preview strip.
 *
 * Separate from the picker so a surface can place it wherever its composer
 * layout needs — above the input in a thread, beside it in a compact bar.
 */
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

  return (
    <div className="flex items-center gap-3 border-t border-border/70 px-3 py-2" aria-live="polite">
      {attachment ? (
        <>
          <div className="relative">
            {attachment.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
              <img
                src={attachment.previewUrl}
                alt="Photo ready to send"
                className="h-14 w-14 rounded-xl object-cover"
              />
            ) : (
              <div className="grid h-14 w-14 place-items-center rounded-xl bg-secondary" aria-hidden="true">
                <ImagePlus className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove photo"
              className="focus-ring absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Photo ready. Add a caption or send.</p>
        </>
      ) : (
        <p className="text-xs text-destructive" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  );
}
