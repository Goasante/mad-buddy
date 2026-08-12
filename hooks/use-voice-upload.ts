"use client";

import { useCallback, useRef, useState } from "react";
import {
  createVoiceMessageUploadIntentAction,
  discardMessageAttachmentAction,
  finalizeVoiceMessageUploadAction
} from "@/app/(app)/messaging-actions";
import type { LocalVoiceRecording } from "@/lib/messaging/voice-recording";
import { browserIsOnline, reportVoiceFailure } from "@/lib/messaging/voice-reliability";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The voice upload lifecycle, without any presentation.
 *
 * Lifted verbatim in behaviour from the previous VoiceRecordingPreview: the
 * intent/upload/finalize sequence, the operation-id guard against stale
 * async work, the discard-on-failure cleanup, and the rule that a READY
 * asset is no longer an in-flight intent. Only the UI around it changed, so
 * none of that logic was rewritten.
 *
 * ONE ERROR AT A TIME. Every failure path sets exactly one message. The old
 * implementation could show a recorder error and a player error together,
 * describing the same problem twice; a hook that owns a single `error`
 * string cannot do that.
 */

export type VoiceUploadState =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "finalizing" }
  | { kind: "ready"; attachment: PreparedVoiceAsset }
  | { kind: "failed"; message: string; retryable: boolean };

export function useVoiceUpload(conversationId: string) {
  const [state, setState] = useState<VoiceUploadState>({ kind: "idle" });
  const intentRef = useRef<string | null>(null);
  const operationRef = useRef(0);

  /** Uploads and verifies a local recording. Safe to call again to retry. */
  const upload = useCallback(
    async (recording: LocalVoiceRecording): Promise<PreparedVoiceAsset | null> => {
      if (!browserIsOnline()) {
        setState({
          kind: "failed",
          message: "You're offline. Your recording is safe here.",
          retryable: true
        });
        return null;
      }

      const operation = ++operationRef.current;
      let mediaId = intentRef.current;

      // A retry after a finalize failure reuses the existing intent rather
      // than uploading the same bytes twice.
      if (!mediaId) {
        setState({ kind: "uploading" });
        let created: Awaited<ReturnType<typeof createVoiceMessageUploadIntentAction>>;
        try {
          created = await createVoiceMessageUploadIntentAction({
            conversationId,
            // The ACTUAL recorded type, not the requested one. MediaRecorder
            // may honour a different container than the one asked for, and
            // the server sniffs the real bytes -- declaring the requested
            // type makes a perfectly good recording fail as a content
            // mismatch. `blobMimeType` is captured for exactly this reason.
            contentType: recording.blobMimeType || recording.mimeType,
            sizeBytes: recording.blob.size
          });
        } catch {
          reportVoiceFailure("upload_intent_failed");
          if (operation === operationRef.current) {
            setState({ kind: "failed", message: "Couldn't send that voice message. Try again.", retryable: true });
          }
          return null;
        }
        if (operation !== operationRef.current) return null;
        if (!created.ok || !created.mediaId || !created.path || !created.token) {
          reportVoiceFailure("upload_intent_failed");
          setState({ kind: "failed", message: created.message, retryable: true });
          return null;
        }
        mediaId = created.mediaId;
        intentRef.current = mediaId;

        try {
          const supabase = createSupabaseBrowserClient();
          const { error } = await supabase.storage
            .from("media")
            .uploadToSignedUrl(created.path, created.token, recording.blob, {
              // Must match the intent above and the bytes themselves.
              contentType: recording.blobMimeType || recording.mimeType,
              upsert: true
            });
          if (error) throw error;
        } catch {
          if (operation !== operationRef.current) return null;
          reportVoiceFailure("upload_failed");
          void discardMessageAttachmentAction(mediaId);
          intentRef.current = null;
          // The RECORDING survives a network failure -- only the upload is
          // discarded, so Retry does not mean "record it again".
          setState({
            kind: "failed",
            message: browserIsOnline()
              ? "Couldn't send that voice message. Try again."
              : "You're offline. Your recording is safe here.",
            retryable: true
          });
          return null;
        }
      }

      if (operation !== operationRef.current) return null;
      setState({ kind: "finalizing" });
      let finalized: Awaited<ReturnType<typeof finalizeVoiceMessageUploadAction>>;
      try {
        finalized = await finalizeVoiceMessageUploadAction({
          conversationId,
          mediaId,
          waveform: recording.waveform,
          // MediaRecorder webm carries no duration in its header, so the
          // server cannot always derive one from the bytes. Sent as a
          // fallback only -- the server prefers the container's own value
          // and bounds this one.
          clientDurationMs: Math.round(recording.durationSeconds * 1000)
        });
      } catch {
        if (operation !== operationRef.current) return null;
        reportVoiceFailure("finalize_failed");
        setState({ kind: "failed", message: "Couldn't send that voice message. Try again.", retryable: true });
        return null;
      }
      if (operation !== operationRef.current) return null;
      if (!finalized.ok || !finalized.mediaId || !finalized.durationMs) {
        reportVoiceFailure("validation_failed");
        void discardMessageAttachmentAction(mediaId);
        intentRef.current = null;
        // The audio itself is unusable, so this is NOT retryable with the
        // same take -- the caller returns to recording.
        //
        // The SERVER's reason is preserved: it distinguishes an unverifiable
        // container from an unverifiable duration from an entitlement limit,
        // and collapsing those into one line makes the failure undiagnosable
        // for the person hitting it and for anyone debugging it.
        setState({
          kind: "failed",
          message: finalized.message || "Couldn't record that voice message. Try again.",
          retryable: false
        });
        return null;
      }

      const attachment: PreparedVoiceAsset = {
        mediaId: finalized.mediaId,
        durationMs: finalized.durationMs,
        waveform: recording.waveform
      };
      // READY is no longer an in-flight intent: a successful send must not
      // let cleanup discard the now-attached asset.
      intentRef.current = null;
      setState({ kind: "ready", attachment });
      return attachment;
    },
    [conversationId]
  );

  /** Abandons any uploaded-but-unsent asset. Safe to call repeatedly. */
  const discard = useCallback(() => {
    operationRef.current += 1;
    const mediaId = intentRef.current ?? (state.kind === "ready" ? state.attachment.mediaId : null);
    if (mediaId) void discardMessageAttachmentAction(mediaId);
    intentRef.current = null;
    setState({ kind: "idle" });
  }, [state]);

  const reset = useCallback(() => {
    operationRef.current += 1;
    intentRef.current = null;
    setState({ kind: "idle" });
  }, []);

  return { state, upload, discard, reset };
}
