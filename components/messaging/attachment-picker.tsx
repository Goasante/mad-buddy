"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
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
 * IMAGES ONLY in this phase. Two entries and no more: Photo Library and
 * Camera. A menu of greyed-out Document / Video / Voice rows would advertise
 * things the pipeline cannot do — dead buttons are worse than absent ones.
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
type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "failed"; message: string };

export function AttachmentPicker({
  conversationId,
  onAttachmentChange,
  disabled = false
}: {
  conversationId: string;
  onAttachmentChange: (next: SelectedAttachment | null) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  // Two inputs, because `capture` is what makes the second one open the
  // camera directly rather than the gallery.
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File | undefined) {
    if (!file) return;
    const selectionError = validateImageSelection(file, "chat");
    if (selectionError) {
      setState({ status: "failed", message: selectionError });
      return;
    }
    setState({ status: "uploading" });
    startTransition(async () => {
      const intent = await createMessageAttachmentUploadIntentAction({
        conversationId,
        contentType: file.type,
        sizeBytes: file.size
      });
      if (!intent.ok || !intent.mediaId || !intent.path || !intent.token) {
        setState({ status: "failed", message: intent.message });
        return;
      }

      let uploadFailed = false;
      try {
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.storage
          .from("media")
          .uploadToSignedUrl(intent.path, intent.token, file, { contentType: file.type });
        uploadFailed = Boolean(error);
      } catch {
        uploadFailed = true;
      }
      if (uploadFailed) {
        void discardMessageAttachmentAction(intent.mediaId);
        setState({ status: "failed", message: "Couldn't upload that photo. Try again." });
        return;
      }

      const result = await finalizeMessageAttachmentUploadAction({
        conversationId,
        mediaId: intent.mediaId
      });
      if (!result.ok || !result.mediaId) {
        // The typed draft is untouched: a failed photo must never cost
        // someone the message they were writing.
        setState({ status: "failed", message: result.message });
        return;
      }
      setState({ status: "idle" });
      onAttachmentChange({ mediaId: result.mediaId, previewUrl: result.previewUrl ?? null });
    });
  }

  const busy = disabled || isPending || state.status === "uploading";

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
          { id: "library", label: "Photo Library", onSelect: () => libraryRef.current?.click(), disabled: busy },
          { id: "camera", label: "Camera", onSelect: () => cameraRef.current?.click(), disabled: busy }
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
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        }
      />
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
