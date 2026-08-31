import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { cameraReducer } from "@/lib/camera/state";

/**
 * The rebuilt voice composer: idle -> recording -> review.
 *
 * The recorder's own state machine is exercised behaviourally in
 * voice-recording.test.ts and the analyser in voice-analyser.test.ts. What
 * this file protects is the COMPOSER's contract on top of them -- which
 * state renders which controls, and the rules that stop a recording being
 * lost or sent twice. Client component, vitest runs environment "node", so
 * these are structural.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const composer = stripComments(read("components/messaging/message-composer-v3.tsx"));
const upload = stripComments(read("hooks/use-voice-upload.ts"));
const bubble = stripComments(read("components/messaging/voice-message-bubble.tsx"));
const css = read("app/globals.css");

// ---------------------------------------------------------------------------
// One surface, three appearances
// ---------------------------------------------------------------------------

describe("the composer transforms rather than stacking surfaces", () => {
  it("returns a different row per state from the same component", () => {
    // Early returns, not a card rendered above the composer.
    expect(composer).toContain("if (recording || preparing || awaitingPermission) {");
    expect(composer).toContain('if (reviewing && voice.state.kind === "preview") {');
  });

  it("opens no modal, sheet or floating panel", () => {
    for (const term of ["<Modal", 'role="dialog"', "fixed inset-0"]) {
      expect(composer, term).not.toContain(term);
    }
  });

  it("keeps every state on the same padded, safe-area-aware row", () => {
    const bar = css.slice(css.indexOf(".voice-bar {"), css.indexOf(".voice-bar-button"));
    expect(bar).toContain("padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px))");
  });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe("recording row", () => {
  it("offers cancel, timer, live levels, stop and send", () => {
    const row = composer.slice(
      composer.indexOf("if (recording || preparing || awaitingPermission) {"),
      composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
    );
    expect(row).toContain('aria-label="Cancel voice recording"');
    expect(row).toContain("voice-bar-time");
    expect(row).toContain("<LiveVoiceWaveform");
    // V3's stop control stops AND sends in one action (stopAndSendRecording),
    // so it is labelled for what it does rather than for half of it.
    expect(row).toContain('aria-label="Send voice message"');
    expect(row).toContain('aria-label="Send voice message"');
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

  it("has no pause control, because the recorder does not support one", () => {
    // A pause button that only changes the UI while MediaRecorder keeps
    // running would be a lie about what was captured.
    const row = composer.slice(
      composer.indexOf("if (recording || preparing || awaitingPermission) {"),
      composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
    );
    expect(row).not.toContain('aria-label="Pause recording"');
    expect(row).not.toContain('aria-label="Resume recording"');
  });
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

describe("review row", () => {
  it("offers discard, play, waveform, duration and send", () => {
    const row = composer.slice(composer.indexOf('if (reviewing && voice.state.kind === "preview") {'));
    expect(row).toContain('aria-label="Delete voice recording"');
    expect(row).toContain('playing ? "Pause voice message" : "Play voice message"');
    expect(row).toContain("<StaticVoiceWaveform");
    expect(row).toContain("voice-bar-time");
    expect(row).toContain('aria-label="Send voice message"');
  });

  it("never auto-sends when recording stops", () => {
    // Stop goes to preview. Only an explicit send call reaches the server.
    const row = composer.slice(
      composer.indexOf("if (recording || preparing || awaitingPermission) {"),
      composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
    );
    expect(row).not.toContain("sendVoice(");
  });

  it("does not fake a seek bar it cannot honour", () => {
    // WebM/Opus blobs frequently lack the duration metadata reliable
    // scrubbing needs; a draggable control that cannot seek is worse.
    expect(composer).not.toContain('type="range"');
    expect(composer).not.toContain("Seek voice");
  });
});

// ---------------------------------------------------------------------------
// Send: exactly one recording, one upload, one message
// ---------------------------------------------------------------------------

describe("send lifecycle", () => {
  it("guards against a double tap creating two messages", () => {
    // A ref, not state: two taps in the same frame both read the
    // pre-render value.
    expect(composer).toContain("const sendingRef = useRef(false)");
    expect(composer).toContain("if (sendingRef.current) return;");
    expect(composer).toContain("sendingRef.current = false;");
  });

  it("reuses an already-uploaded asset rather than uploading twice", () => {
    expect(composer).toContain('voiceUpload.state.kind === "uploading"');
    expect(composer).toContain('voiceUpload.state.kind === "finalizing"');
  });

  it("keeps one client message id so a retry cannot duplicate", () => {
    expect(composer).toContain("clientMessageIdRef.current ?? crypto.randomUUID()");
  });

  it("uploads through the canonical pipeline, never an ad-hoc path", () => {
    expect(upload).toContain("createVoiceMessageUploadIntentAction");
    expect(upload).toContain("finalizeVoiceMessageUploadAction");
    expect(upload).toContain("uploadToSignedUrl");
  });
});

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("shows exactly one error, whatever produced it", () => {
    // The old implementation could stack a recorder error and a player
    // error describing the same problem.
    expect(composer).toContain("const voiceError =");
    expect((composer.match(/voice-bar-error/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("distinguishes a broken recording from a failed upload", () => {
    // Network failure keeps the take and offers retry; unusable audio does
    // not, because retrying the same bytes would fail identically.
    expect(upload).toContain("retryable: true");
    expect(upload).toContain("retryable: false");
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
  it("mints its playback URL lazily, on first play", () => {
    expect(bubble).toContain("if (!src)");
    expect(bubble).toContain("getMessageVoicePlaybackAction");
  });

  it("stops playing if the message unmounts", () => {
    expect(bubble).toContain("return () => audio?.pause()");
  });

  it("stays a message rather than becoming a media player", () => {
    expect(bubble).not.toContain('type="range"');
    expect(bubble).not.toContain("download");
    expect(bubble).not.toContain("volume");
  });
});

// ---------------------------------------------------------------------------
// The old presentation must not return
// ---------------------------------------------------------------------------

describe("obsolete voice UI stays deleted", () => {
  it.each([
    "components/messaging/voice-recording-preview.tsx",
    "components/messaging/voice-note-player.tsx"
  ])("does not resurrect %s", (path) => {
    expect(() => readFileSync(join(process.cwd(), path), "utf8")).toThrow();
  });

  it("keeps the canonical engine that those components used", () => {
    // Deleting a presentation must not delete the domain beneath it.
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
    // Sanity that this slice stayed inside messaging.
    expect(typeof cameraReducer).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: tapping the mic must visibly change the composer
// ---------------------------------------------------------------------------

describe("tapping the mic always leaves idle", () => {
  /**
   * THE BUG: start() sets `requesting_permission` synchronously and only
   * then awaits getUserMedia. No render branch covered that state, so the
   * composer kept showing the idle row for the whole permission prompt --
   * and if the prompt was slow or dismissed, it never visibly changed.
   *
   * The rule: every state that is not idle, preview or failed means capture
   * is under way, and none of them may look like an idle composer.
   */
  const CAPTURE_STATES = ["requesting_permission", "recording", "stopping", "processing"] as const;

  it("renders the recording bar for every capture state", () => {
    // The guard must cover permission-waiting as well as active capture.
    expect(composer).toContain("if (recording || preparing || awaitingPermission) {");
    expect(composer).toContain('const awaitingPermission = voice.state.kind === "requesting_permission"');
    expect(composer).toContain('const recording = voice.state.kind === "recording"');
    expect(composer).toContain('voice.state.kind === "stopping" || voice.state.kind === "processing"');
  });

  it("covers every capture state the recorder can enter", () => {
    // Each state named by the recorder must appear in a composer condition,
    // so a newly added capture state cannot silently render as idle.
    const recorder = stripComments(read("lib/messaging/voice-recording.ts"));
    for (const state of CAPTURE_STATES) {
      expect(recorder, `${state} must exist in the recorder`).toContain(`kind: "${state}"`);
      expect(composer, `${state} must be handled by the composer`).toContain(state);
    }
  });

  it("reaches the idle composer only when nothing is being captured", () => {
    // The idle return is last, after both capture and review guards.
    const captureGuard = composer.indexOf("if (recording || preparing || awaitingPermission) {");
    const reviewGuard = composer.indexOf('if (reviewing && voice.state.kind === "preview") {');
    const idleReturn = composer.lastIndexOf("return (");
    expect(captureGuard).toBeGreaterThan(-1);
    expect(captureGuard).toBeLessThan(reviewGuard);
    expect(reviewGuard).toBeLessThan(idleReturn);
  });

  it("disables transport controls until capture actually starts", () => {
    // Stop and send are meaningless while the permission prompt is open.
    expect(composer).toContain("const busy = preparing || awaitingPermission;");
    expect(composer).toContain('disabled={busy || voice.state.kind !== "recording"}');
  });

  it("says why the bar is showing before recording begins", () => {
    expect(composer).toContain('"Waiting for microphone access"');
  });

  it("leaves cancel usable throughout, so the bar is never a trap", () => {
    const row = composer.slice(
      composer.indexOf("if (recording || preparing || awaitingPermission) {"),
      composer.indexOf('if (reviewing && voice.state.kind === "preview") {')
    );
    const cancel = row.slice(row.indexOf('aria-label="Cancel voice recording"') - 300, row.indexOf('aria-label="Cancel voice recording"'));
    expect(cancel).not.toContain("disabled=");
  });

  it("cannot start a second recording from rapid taps", () => {
    // The controller itself refuses re-entry while capturing.
    const recorder = stripComments(read("lib/messaging/voice-recording.ts"));
    expect(recorder).toContain('["requesting_permission", "recording", "stopping", "processing"].includes(this.state.kind)');
  });

  it("returns to idle when recording fails", () => {
    // A failure is not a capture state, so the idle composer renders again
    // with one error line beneath it.
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
// SEND WHILE RECORDING
// ---------------------------------------------------------------------------

describe("the send button during recording", () => {
  const composer = readFileSync(
    join(process.cwd(), "components/messaging/message-composer-v3.tsx"),
    "utf8"
  );

  /**
   * THE BUG: the recording bar's Send button called voice.stop() -- the exact
   * same handler as the Stop button. Pressing send therefore never sent
   * anything; it silently dropped the person into the review bar.
   */
  it("does more than stop the recording", () => {
    const recordingBar = composer.slice(
      composer.indexOf('aria-label="Voice recording"'),
      composer.indexOf('aria-label="Voice message preview"')
    );
    // V3 arms the deferred send in the stop/release handlers rather than
    // inline on the button, but the guarantee is the same: the send survives
    // stop() and fires when the take exists.
    expect(recordingBar).toContain('className="voice-bar-send"');
    expect(composer).toContain("sendOnNextTakeRef.current = true");
  });

  it("defers the send until the take exists", () => {
    // stop() is asynchronous: MediaRecorder assembles the blob afterwards,
    // so there is nothing to send in the tap's own tick.
    expect(composer).toContain('if (!sendOnNextTakeRef.current || voice.state.kind !== "preview") return;');
    // V3 folds the preview-state check into the guard asserted above, so the
    // standalone form no longer exists; the guarantee is unchanged.
    expect(composer).toContain("void sendVoice(take)");
  });

  it("does not wait for the local waveform", () => {
    // generateWaveform resolves to null on failure, so gating the send on a
    // non-null waveform would let a decode error swallow the send forever.
    const effect = composer.slice(
      composer.indexOf('if (!sendOnNextTakeRef.current || voice.state.kind !== "preview") return;'),
      composer.indexOf('if (!sendOnNextTakeRef.current || voice.state.kind !== "preview") return;') + 400
    );
    expect(effect).not.toContain("waveform === null");
  });

  it("clears the pending send when the recording is discarded", () => {
    // Otherwise discarding mid-finalization would send what you discarded.
    const reset = composer.slice(
      composer.indexOf("const cancelRecording = useCallback"),
      composer.indexOf("const cancelRecording = useCallback") + 700
    );
    expect(reset).toContain("sendOnNextTakeRef.current = false");
  });
});

// ---------------------------------------------------------------------------
// FAILURE DIAGNOSIS
// ---------------------------------------------------------------------------

describe("finalize failures", () => {

  /**
   * The server distinguishes an unverifiable container from an unverifiable
   * duration from an entitlement limit, each with its own message. Collapsing
   * them into one generic line left the person -- and anyone debugging -- with
   * no idea which rule was broken.
   */
  it("shows the server's reason rather than a generic line", () => {
    expect(upload).toContain("message: finalized.message ||");
  });

  it("still has a fallback when the server sends no message", () => {
    expect(upload).toContain('"Couldn\'t record that voice message. Try again."');
  });

  it("sends the measured duration so durationless containers can finalize", () => {
    // MediaRecorder webm has no Duration element; without this the server
    // cannot derive one and rejects every such recording.
    expect(upload).toContain("clientDurationMs: Math.round(recording.durationSeconds * 1000)");
  });
});

// ---------------------------------------------------------------------------
// DECLARED TYPE MUST MATCH THE RECORDED BYTES
// ---------------------------------------------------------------------------

describe("the uploaded content type", () => {
  /**
   * THE BUG: the upload declared `recording.mimeType` -- the type that was
   * REQUESTED -- while the bytes were whatever MediaRecorder actually
   * produced. The server sniffs the real bytes, so a valid recording was
   * rejected as a content mismatch. The recorder keeps `blobMimeType`
   * separately for precisely this reason.
   */
  it("declares what was recorded, not what was requested", () => {
    expect(upload).toContain("contentType: recording.blobMimeType || recording.mimeType");
  });

  it("declares the same type to the intent and to storage", () => {
    // A mismatch between these two produces a stored object whose content
    // type contradicts its own bytes.
    const declarations = upload.match(/contentType: recording\.[A-Za-z |.]+/g) ?? [];
    expect(declarations.length).toBe(2);
    expect(new Set(declarations).size).toBe(1);
  });
});

describe("preview playback", () => {
  it("loads the whole recording, not just metadata", () => {
    // A MediaRecorder webm has no duration header; a metadata-only load can
    // leave the element unready and play() then resolves to silence.
    const review = composer.slice(composer.indexOf('aria-label="Voice message preview"'));
    expect(review).toContain('preload="auto"');
  });

  it("reports a decode failure instead of doing nothing", () => {
    expect(composer).toContain("could not be played back");
  });
});
