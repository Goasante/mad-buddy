import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { cameraReducer } from "@/lib/camera/state";

/**
 * Voice composer contract: idle -> recording -> review -> explicit send.
 *
 * The recorder's own state machine is covered in voice-recording.test.ts. This
 * file protects the composer controls layered on top of it and the sent-player
 * lifecycle that must not interrupt playback as progress changes.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const composer = stripComments(read("components/messaging/message-composer-v3.tsx"));
const upload = stripComments(read("hooks/use-voice-upload.ts"));
const bubble = stripComments(read("components/messaging/voice-message-bubble-v4.tsx"));
const css = read("app/globals.css");

// ---------------------------------------------------------------------------
// One surface, three appearances
// ---------------------------------------------------------------------------

describe("the composer transforms rather than stacking surfaces", () => {
  it("returns a different row per state from the same component", () => {
    expect(composer).toContain("if (recording || preparing || awaitingPermission) {");
    expect(composer).toContain('if (reviewing && voice.state.kind === "preview") {');
  });

  it("opens no modal, sheet or floating panel", () => {
    for (const term of ["<Modal", 'role="dialog"', "fixed inset-0"]) {
      expect(composer, term).not.toContain(term);
    }
  });

  it("keeps every state on the same safe-area-aware row", () => {
    const bar = css.slice(css.indexOf(".voice-bar {"), css.indexOf(".voice-bar-button"));
    expect(bar).toContain("padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px))");
  });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe("recording row", () => {
  const row = composer.slice(
    composer.indexOf("if (recording || preparing || awaitingPermission) {"),
    composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
  );

  it("offers cancel, timer, live levels and an explicit finish-for-review control", () => {
    expect(row).toContain('aria-label="Cancel voice recording"');
    expect(row).toContain("voice-bar-time");
    expect(row).toContain("<LiveVoiceWaveform");
    expect(row).toContain('aria-label="Review voice message"');
    expect(row).toContain("finishRecordingForReview");
    expect(row).toContain("<Check");
  });

  it("feeds the waveform the recorder's own stream, never a second capture", () => {
    expect(composer).toContain("stream={voice.captureStream}");
    expect(composer).not.toContain("getUserMedia");
  });

  it("states recording in words, not by colour or motion alone", () => {
    expect(composer).toContain('<span className="sr-only" role="status">');
    expect(composer).toContain("`Recording, ${formatDuration(elapsed)}`");
  });

  it("shows elapsed time only, never a ceiling to fill", () => {
    expect(composer).not.toContain("maxDurationSeconds}");
  });

  it("has no fake pause control while MediaRecorder keeps running", () => {
    expect(row).not.toContain('aria-label="Pause recording"');
    expect(row).not.toContain('aria-label="Resume recording"');
  });

  it("never sends directly from the active recording row", () => {
    expect(row).not.toContain("sendVoice(");
    expect(row).not.toContain('aria-label="Send voice message"');
  });
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

describe("review row", () => {
  const row = composer.slice(composer.indexOf('if (reviewing && voice.state.kind === "preview") {'));

  it("offers X discard, play/pause, waveform, duration and confirm/send", () => {
    expect(row).toContain('aria-label="Discard voice recording"');
    expect(row).toContain("<X");
    expect(row).toContain('playing ? "Pause voice message" : "Play voice message"');
    expect(row).toContain("<StaticVoiceWaveform");
    expect(row).toContain("voice-bar-time");
    expect(row).toContain('aria-label="Send voice message"');
    expect(row).toContain("<Check");
  });

  it("plays the captured object URL locally before anything is uploaded", () => {
    expect(row).toContain("src={take.objectUrl}");
    expect(row).toContain('preload="auto"');
    expect(row).toContain("audio.play()");
  });

  it("sends only from an explicit review action", () => {
    expect(row).toContain("onClick={() => void sendVoice(take)}");
    expect(composer).not.toContain("sendOnNextTakeRef");
  });

  it("does not fake a seek bar it cannot reliably honour", () => {
    expect(composer).not.toContain('type="range"');
    expect(composer).not.toContain("Seek voice");
  });
});

// ---------------------------------------------------------------------------
// Finish gesture -> review, never surprise-send
// ---------------------------------------------------------------------------

describe("finishing a recording always enters review first", () => {
  it("turns hold release into review rather than send", () => {
    expect(composer).toContain('type DeferredRelease = "tap" | "review" | "lock" | "cancel"');
    expect(composer).toContain('mode = "review"');
    expect(composer).toContain("Release to review");
    expect(composer).not.toContain('mode = "send"');
  });

  it("the hands-free check stops capture without arming an automatic send", () => {
    const finish = composer.slice(
      composer.indexOf("function finishRecordingForReview()"),
      composer.indexOf("const voiceError =")
    );
    expect(finish).toContain("voice.stop()");
    expect(finish).not.toContain("sendVoice");
    expect(finish).not.toContain("sendOnNextTakeRef");
  });

  it("keeps permission-interrupted gestures safe and reviewable", () => {
    expect(composer).toContain('deferredReleaseRef.current = permissionPromptLikelyRef.current && mode === "review" ? "lock" : mode');
    expect(composer).toContain("tap the check when you’re done");
  });

  it("discarding review also stops local playback and resets its progress", () => {
    const reset = composer.slice(
      composer.indexOf("const cancelRecording = useCallback"),
      composer.indexOf("const applyRelease = useCallback")
    );
    expect(reset).toContain("audioRef.current?.pause()");
    expect(reset).toContain("setPlaying(false)");
    expect(reset).toContain("setPlayedSeconds(0)");
    expect(reset).toContain("voice.cancel()");
  });
});

// ---------------------------------------------------------------------------
// Send: one recording, one upload, one message
// ---------------------------------------------------------------------------

describe("send lifecycle", () => {
  it("guards against a double tap creating two messages", () => {
    expect(composer).toContain("const sendingRef = useRef(false)");
    expect(composer).toContain("if (sendingRef.current) return;");
    expect(composer).toContain("sendingRef.current = false;");
  });

  it("reuses the canonical upload pipeline", () => {
    expect(composer).toContain('voiceUpload.state.kind === "uploading"');
    expect(composer).toContain('voiceUpload.state.kind === "finalizing"');
    expect(upload).toContain("createVoiceUploadIntentViaApi");
    expect(upload).toContain("finalizeVoiceUploadViaApi");
    expect(upload).toContain("createSupabaseBrowserClient");
    expect(upload).toContain("uploadToSignedUrl");
    expect(upload).not.toContain("createVoiceMessageUploadIntentAction");
    expect(upload).not.toContain("finalizeVoiceMessageUploadAction");
  });

  it("keeps idempotent message identity behavior", () => {
    expect(composer).toContain("clientMessageIdRef.current ?? crypto.randomUUID()");
    expect(composer).toContain("const clientMessageId = crypto.randomUUID()");
  });
});

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("shows one composer error channel", () => {
    expect(composer).toContain("const voiceError =");
    expect((composer.match(/voice-bar-error/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("distinguishes retryable finalize failures", () => {
    expect(upload).toContain("retryable: true");
    expect(upload).toContain("const retryable = !/record it again|can be up to/i.test(finalized.message);");
    expect(upload).toContain("if (!retryable) intentRef.current = null;");
  });

  it("keeps the recording when the network fails", () => {
    const uploadFailure = upload.slice(upload.indexOf('reportVoiceFailure("upload_failed")'));
    expect(uploadFailure.slice(0, 500)).toContain("retryable: true");
  });

  it("uses plain language, never codec or MIME terms", () => {
    for (const term of ["MIME", "codec", "webm", "opus", "mp4"]) {
      expect(composer.toLowerCase(), term).not.toContain(term.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------
// Sent messages
// ---------------------------------------------------------------------------

describe("a sent voice message", () => {
  it("prefetches playback authority but only plays from an explicit tap", () => {
    expect(bubble).toContain("getVoiceMessagePlaybackViaApi");
    expect(bubble).not.toContain("getMessageVoicePlaybackAction");
    expect(bubble).toContain("if (!playback || voicePlaybackNeedsRefresh(playback.expiresAt)) {");
    expect(bubble).toContain("await audio.play()");
  });

  it("does not pause itself on every timeupdate", () => {
    expect(bubble).toContain("const elapsedRef = useRef(Math.max(0, initialSeconds))");
    expect(bubble).toContain("elapsedRef.current = next");
    expect(bubble).toContain("const currentElapsed = elapsedRef.current");
    expect(bubble).toContain("}, [conversationId, messageId]);");
    expect(bubble).not.toContain("[conversationId, elapsed, messageId]");
  });

  it("still stops playback when the bubble genuinely unmounts", () => {
    expect(bubble).toContain("audioRef.current?.pause()");
  });

  it("keeps pause/play state driven by the real audio element", () => {
    expect(bubble).toContain("onPlay={() => setPlaying(true)}");
    expect(bubble).toContain("onPause={() => setPlaying(false)}");
    expect(bubble).toContain("onEnded={() => {");
  });

  it("stays a message rather than becoming a generic media player", () => {
    expect(bubble).not.toContain('type="range"');
    expect(bubble).not.toContain("download");
    expect(bubble).not.toContain("volume");
  });
});

// ---------------------------------------------------------------------------
// Existing recorder and media foundations stay intact
// ---------------------------------------------------------------------------

describe("voice foundations remain canonical", () => {
  it.each([
    "components/messaging/voice-recording-preview.tsx",
    "components/messaging/voice-note-player.tsx"
  ])("does not resurrect obsolete %s", (path) => {
    expect(() => readFileSync(join(process.cwd(), path), "utf8")).toThrow();
  });

  it("keeps the domain modules beneath the presentation", () => {
    for (const path of [
      "lib/messaging/voice-recording.ts",
      "lib/messaging/voice-message-service.ts",
      "lib/media/voice-playback-service.ts",
      "lib/messaging/voice-waveform.ts",
      "lib/messaging/voice-reliability.ts"
    ]) {
      expect(read(path).length, path).toBeGreaterThan(0);
    }
  });

  it("keeps unrelated reducers untouched", () => {
    expect(typeof cameraReducer).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Tapping mic must visibly leave idle
// ---------------------------------------------------------------------------

describe("tapping the mic always leaves idle", () => {
  const CAPTURE_STATES = ["requesting_permission", "recording", "stopping", "processing"] as const;

  it("renders the recording bar for every capture state", () => {
    expect(composer).toContain("if (recording || preparing || awaitingPermission) {");
    expect(composer).toContain('const awaitingPermission = voice.state.kind === "requesting_permission"');
    expect(composer).toContain('const recording = voice.state.kind === "recording"');
    expect(composer).toContain('voice.state.kind === "stopping" || voice.state.kind === "processing"');
  });

  it("covers every capture state the recorder can enter", () => {
    const recorder = stripComments(read("lib/messaging/voice-recording.ts"));
    for (const state of CAPTURE_STATES) {
      expect(recorder, `${state} must exist in the recorder`).toContain(`kind: "${state}"`);
      expect(composer, `${state} must be handled by the composer`).toContain(state);
    }
  });

  it("reaches idle only after capture and review guards", () => {
    const captureGuard = composer.indexOf("if (recording || preparing || awaitingPermission) {");
    const reviewGuard = composer.indexOf('if (reviewing && voice.state.kind === "preview") {');
    const idleReturn = composer.lastIndexOf("return (");
    expect(captureGuard).toBeGreaterThan(-1);
    expect(captureGuard).toBeLessThan(reviewGuard);
    expect(reviewGuard).toBeLessThan(idleReturn);
  });

  it("disables finish until capture actually starts", () => {
    expect(composer).toContain("const busy = preparing || awaitingPermission;");
    expect(composer).toContain('disabled={busy || voice.state.kind !== "recording"}');
    expect(composer).toContain('"Waiting for microphone access"');
  });

  it("leaves cancel usable throughout", () => {
    const row = composer.slice(
      composer.indexOf("if (recording || preparing || awaitingPermission) {"),
      composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
    );
    const cancel = row.slice(row.indexOf('aria-label="Cancel voice recording"') - 300, row.indexOf('aria-label="Cancel voice recording"'));
    expect(cancel).not.toContain("disabled=");
  });

  it("cannot start a second recording from rapid taps", () => {
    const recorder = stripComments(read("lib/messaging/voice-recording.ts"));
    expect(recorder).toContain('["requesting_permission", "recording", "stopping", "processing"].includes(this.state.kind)');
  });

  it("returns to idle when recording fails", () => {
    expect(composer).toContain('voice.state.kind === "failed"');
    expect(composer).toContain("voice-bar-error");
  });

  it("stops the analyser when the waveform unmounts", () => {
    const waveform = stripComments(read("components/messaging/voice-waveform-bar.tsx"));
    expect(waveform).toContain("return () => {");
    expect(waveform).toContain("analyser.stop();");
  });
});

// ---------------------------------------------------------------------------
// Upload correctness
// ---------------------------------------------------------------------------

describe("finalize and upload correctness", () => {
  it("shows the server's reason with a fallback", () => {
    expect(upload).toContain("message: finalized.message ||");
    expect(upload).toContain('"Couldn\'t record that voice message. Try again."');
  });

  it("sends measured duration for durationless containers", () => {
    expect(upload).toContain("clientDurationMs: Math.round(recording.durationSeconds * 1000)");
  });

  it("declares what was actually recorded to intent and storage", () => {
    expect(upload).toContain("contentType: recording.blobMimeType || recording.mimeType");
    const declarations = upload.match(/contentType: recording\.[A-Za-z |.]+/g) ?? [];
    expect(declarations.length).toBe(2);
    expect(new Set(declarations).size).toBe(1);
  });
});

describe("preview playback", () => {
  it("loads the whole recording, not just metadata", () => {
    const review = composer.slice(composer.indexOf('aria-label="Voice message preview"'));
    expect(review).toContain('preload="auto"');
  });

  it("reports a decode failure instead of doing nothing", () => {
    expect(composer).toContain("could not be played back");
  });
});
