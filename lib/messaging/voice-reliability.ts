export const VOICE_FAILURE_CATEGORIES = [
  "recording_unsupported",
  "permission_denied",
  "recording_interrupted",
  "upload_intent_failed",
  "upload_failed",
  "finalize_failed",
  "validation_failed",
  "send_failed",
  "playback_authorization_failed",
  "playback_failed",
  "refresh_failed"
] as const;

export type VoiceFailureCategory = (typeof VOICE_FAILURE_CATEGORIES)[number];

/**
 * Privacy-safe client diagnostics. Only a fixed category and connectivity bit
 * are emitted; media, message, user, URL and parser data never enter logs.
 */
export function reportVoiceFailure(category: VoiceFailureCategory): void {
  if (typeof console === "undefined") return;
  console.warn("[voice-note] operation failed", {
    category,
    online: browserIsOnline()
  });
}

export function browserIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
