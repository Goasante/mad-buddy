"use client";

import { useCallback, useRef, useState } from "react";
import { discardMessageAttachmentAction } from "@/app/(app)/messaging-actions";
import { uploadMediaToSignedUrlWithProgress } from "@/lib/media/signed-upload-progress";
import {
  createVoiceUploadIntentViaApi,
  finalizeVoiceUploadViaApi
} from "@/lib/messaging/media-upload-client";
import type { LocalVoiceRecording } from "@/lib/messaging/voice-recording";
import { browserIsOnline, reportVoiceFailure } from "@/lib/messaging/voice-reliability";
import type { PreparedVoiceAsset } from "@/lib/messaging/voice-playback";

/**
 * The voice upload lifecycle, without any presentation.
 *
 * Raw audio bytes go straight from the browser to private Supabase Storage.
 * Intent and finalize used to be React Server Actions, which put a voice note
 * back on the same congestible lane as draft/presence mutations. They now use
 * the independent messaging media JSON lane while retaining the exact server
 * authorization, entitlement and byte/container validation services.
 *
 * ONE ERROR AT A TIME. Every failure path sets exactly one message. A local
 * recording survives retryable network failure; only an invalid recording is
 * abandoned and requires a new take.
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
      const contentType = recording.blobMimeType || recording.mimeType;

      // A retry after a finalize failure reuses the existing uploaded asset
      // rather than sending the same audio bytes twice.
      if (!mediaId) {
        setState({ kind: "uploading" });
        const created = await createVoiceUploadIntentViaApi({
          conversationId,
          // MediaRecorder may emit a different supported container than the one
          // requested. The recorder's actual Blob type is the authority.
          contentType,
          sizeBytes: recording.blob.size
        });
        if (operation !== operationRef.current) return null;
        if (!created.ok || !created.mediaId || !created.path || !created.token) {
          reportVoiceFailure("upload_intent_failed");
          setState({ kind: "failed", message: created.message, retryable: true });
          return null;
        }

        mediaId = created.mediaId;
        intentRef.current = mediaId;

        try {
          await uploadMediaToSignedUrlWithProgress({
            path: created.path,
            token: created.token,
            file: recording.blob,
            contentType,
            upsert: false
          });
        } catch {
          if (operation !== operationRef.current) return null;
          reportVoiceFailure("upload_failed");
          void discardMessageAttachmentAction(mediaId);
          intentRef.current = null;
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
      const finalized = await finalizeVoiceUploadViaApi({
        conversationId,
        mediaId,
        waveform: recording.waveform,
        // WebM MediaRecorder output does not always carry a usable duration in
        // its header. This remains a bounded fallback; the server verifies the
        // container/codec and enforces the account duration limit.
        clientDurationMs: Math.round(recording.durationSeconds * 1000)
      });
      if (operation !== operationRef.current) return null;

      if (!finalized.ok || !finalized.mediaId || !finalized.durationMs) {
        reportVoiceFailure("validation_failed");
        // A transport collision such as "already being processed" is safe to
        // retry against the same uploaded object. Only an authoritative invalid
        // take / duration rejection requires a new recording.
        const retryable = !/record it again|can be up to/i.test(finalized.message);
        if (!retryable) intentRef.current = null;
        setState({
          kind: "failed",
          message: finalized.message || "Couldn't record that voice message. Try again.",
          retryable
        });
        return null;
      }

      const attachment: PreparedVoiceAsset = {
        mediaId: finalized.mediaId,
        durationMs: finalized.durationMs,
        waveform: recording.waveform
      };
      // READY is no longer an in-flight intent: a successful send must not let
      // cleanup discard the now-attached asset.
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
