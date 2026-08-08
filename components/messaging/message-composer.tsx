"use client";

import { Loader2, Send } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { sendMessageAction } from "@/app/(app)/messaging-actions";
import {
  AttachmentPicker,
  AttachmentPreview,
  discardAttachment,
  type AttachmentUploadLifecycle,
  type SelectedAttachment
} from "@/components/messaging/attachment-picker";
import { isRequestTimeoutError, withTimeout } from "@/lib/network/resilience";
import { cn } from "@/lib/utils";

type MessageComposerProps = {
  conversationId: string;
  placeholder: string;
  onFeedback: (message: string) => void;
  onSent: () => void | Promise<void>;
  className?: string;
};

/** Canonical text + image composer shared by every real conversation surface. */
export function MessageComposer({
  conversationId,
  placeholder,
  onFeedback,
  onSent,
  className
}: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<SelectedAttachment | null>(null);
  const [uploadState, setUploadState] = useState<AttachmentUploadLifecycle>("idle");
  const [isPending, startTransition] = useTransition();
  const clientMessageIdRef = useRef<string | null>(null);

  const uploadBusy = uploadState === "selected" || uploadState === "uploading" || uploadState === "processing";
  const canSend = Boolean(draft.trim() || attachment);

  function send() {
    const text = draft.trim();
    if ((!text && !attachment) || uploadBusy || isPending) return;

    const clientMessageId = clientMessageIdRef.current ?? crypto.randomUUID();
    clientMessageIdRef.current = clientMessageId;
    setUploadState("sending");
    onFeedback("");
    startTransition(async () => {
      try {
        const result = await withTimeout(
          sendMessageAction({
            conversationId,
            text,
            mediaId: attachment?.mediaId,
            clientMessageId
          }),
          { operation: "send message" }
        );
        onFeedback(result.message);
        if (!result.ok) {
          setUploadState(attachment ? "ready" : "idle");
          return;
        }

        setDraft("");
        setAttachment(null);
        setUploadState("idle");
        clientMessageIdRef.current = null;
        await onSent();
      } catch (error) {
        setUploadState(attachment ? "ready" : "idle");
        onFeedback(
          isRequestTimeoutError(error)
            ? "Sending took too long. Your message was kept so you can try again."
            : "The message could not be sent. Try again."
        );
      }
    });
  }

  return (
    <div className={cn("border-t border-border/70 bg-background/80", className)}>
      <AttachmentPreview
        attachment={attachment}
        onRemove={() => {
          discardAttachment(attachment);
          setAttachment(null);
          setUploadState("idle");
        }}
      />
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <AttachmentPicker
          conversationId={conversationId}
          onAttachmentChange={setAttachment}
          onLifecycleChange={setUploadState}
          disabled={isPending}
        />
        <div className="flex min-w-0 flex-1 items-center rounded-full bg-secondary/70 px-2 focus-within:bg-secondary">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={attachment ? "Add a caption" : placeholder}
            aria-label={attachment ? "Photo caption" : placeholder}
            maxLength={2000}
            disabled={isPending}
            className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend || uploadBusy || isPending}
            aria-label="Send message"
            className={cn(
              "focus-ring safe-motion grid h-10 w-10 shrink-0 place-items-center rounded-full",
              canSend && !uploadBusy && !isPending
                ? "bg-primary text-primary-foreground"
                : "scale-90 bg-transparent text-muted-foreground"
            )}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
