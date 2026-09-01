import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  detectVoiceRecordingCapability,
  MIN_VOICE_RECORDING_BYTES,
  recorderError,
  VoiceRecorderController,
  type MediaRecorderLike,
  type VoiceRecordingRuntime
} from "@/lib/messaging/voice-recording";
import { messagingLimitsFor } from "@/lib/messaging/rules";
import { stripComments } from "@/lib/content/strip-comments";

class FakeTrack {
  kind = "audio";
  enabled = true;
  muted = false;
  readyState: MediaStreamTrackState = "live";
  stopCount = 0;
  private ended: (() => void) | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "ended") this.ended = listener as () => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === "ended" && this.ended === listener) this.ended = null;
  }

  stop() {
    this.stopCount += 1;
    this.readyState = "ended";
  }

  endUnexpectedly() {
    this.ended?.();
  }
}

class FakeRecorder implements MediaRecorderLike {
  state = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  startCount = 0;
  stopCount = 0;
  startTimeslice: number | undefined;

  constructor(mimeType: string) {
    this.mimeType = mimeType;
  }

  start(timeslice?: number) {
    this.startCount += 1;
    this.startTimeslice = timeslice;
    this.state = "recording";
  }

  stop() {
    this.stopCount += 1;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(512)], { type: this.mimeType }) });
    this.onstop?.();
  }

  fail() {
    this.state = "inactive";
    this.onerror?.();
  }
}

function harness(overrides: Partial<VoiceRecordingRuntime> = {}) {
  let nowMs = 0;
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track as unknown as MediaStreamTrack],
    getAudioTracks: () => [track as unknown as MediaStreamTrack]
  } as unknown as MediaStream;
  const recorders: FakeRecorder[] = [];
  const intervals = new Map<number, () => void>();
  const revoked: string[] = [];
  let nextInterval = 1;
  let nextUrl = 1;

  const runtime: VoiceRecordingRuntime = {
    secureContext: true,
    getUserMedia: vi.fn(async () => {
      // Each browser request returns a fresh live track. Reuse the fake object
      // while restoring that lifecycle for concise controller tests.
      track.enabled = true;
      track.muted = false;
      track.readyState = "live";
      return stream;
    }),
    createMediaRecorder: vi.fn((_stream, options) => {
      const recorder = new FakeRecorder(options.mimeType ?? "audio/webm");
      recorders.push(recorder);
      return recorder;
    }),
    isTypeSupported: (mime) => mime === "audio/webm;codecs=opus",
    now: () => nowMs,
    setInterval: (callback) => {
      const id = nextInterval++;
      intervals.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (handle) => intervals.delete(handle as unknown as number),
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    createObjectURL: () => `blob:voice-${nextUrl++}`,
    revokeObjectURL: (url) => revoked.push(url),
    ...overrides
  };

  return {
    runtime,
    track,
    stream,
    recorders,
    revoked,
    advance(ms: number) {
      nowMs += ms;
      for (const callback of [...intervals.values()]) callback();
    }
  };
}

describe("voice recording capability", () => {
  it("prefers WebM/Opus, the format Chromium actually produces", () => {
    // This previously asserted MP4-first, on the theory that some engines
    // record webm but cannot decode it. The real failure is the opposite:
    // Chromium reports isTypeSupported("audio/mp4") === true and then emits
    // WebM bytes, so the pipeline was told one container and handed another.
    const h = harness({ isTypeSupported: () => true });
    expect(detectVoiceRecordingCapability(h.runtime)).toEqual({
      supported: true,
      mimeType: "audio/webm;codecs=opus"
    });
  });

  it("falls back to MP4 without user-agent detection", () => {
    const h = harness({ isTypeSupported: (mime) => mime === "audio/mp4" });
    expect(detectVoiceRecordingCapability(h.runtime)).toEqual({ supported: true, mimeType: "audio/mp4" });
    const source = readFileSync(join(process.cwd(), "lib/messaging/voice-recording.ts"), "utf8");
    expect(source).not.toMatch(/userAgent|iPhone|Safari|Chrome/);
  });

  it("fails honestly when media APIs or a compatible MIME are unavailable", () => {
    expect(detectVoiceRecordingCapability({ ...harness().runtime, getUserMedia: undefined })).toEqual({
      supported: false,
      reason: "media_devices_unavailable"
    });
    expect(detectVoiceRecordingCapability({ ...harness().runtime, isTypeSupported: () => false })).toEqual({
      supported: false,
      reason: "mime_unsupported"
    });
  });
});

describe("voice recorder controller", () => {
  it("requests permission only when start is explicitly called", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    expect(h.runtime.getUserMedia).not.toHaveBeenCalled();
    await controller.start();
    expect(h.runtime.getUserMedia).toHaveBeenCalledOnce();
    expect(h.runtime.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(h.recorders[0].startTimeslice).toBeUndefined();
    expect(controller.getState().kind).toBe("recording");
  });

  it("refuses a missing, muted, disabled, or ended microphone track", async () => {
    for (const state of ["missing", "muted", "disabled", "ended"] as const) {
      const h = harness();
      h.runtime.getUserMedia = vi.fn(async () => {
        if (state === "missing") {
          return {
            getTracks: () => [],
            getAudioTracks: () => []
          } as unknown as MediaStream;
        }
        h.track.muted = state === "muted";
        h.track.enabled = state !== "disabled";
        h.track.readyState = state === "ended" ? "ended" : "live";
        return h.stream;
      });
      const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
      await controller.start();
      expect(controller.getState()).toMatchObject({ kind: "failed", code: "microphone_unavailable" });
    }
  });

  it("waits for a trailing final data chunk before creating the preview", async () => {
    class StopFirstRecorder extends FakeRecorder {
      override stop() {
        this.stopCount += 1;
        this.state = "inactive";
        this.onstop?.();
        globalThis.setTimeout(() => {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array(MIN_VOICE_RECORDING_BYTES + 32)], { type: this.mimeType })
          });
        }, 10);
      }
    }
    const h = harness({
      createMediaRecorder: vi.fn((_stream, options) => new StopFirstRecorder(options.mimeType ?? "audio/webm"))
    });
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    controller.stop();

    expect(controller.getState().kind).toBe("stopping");
    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    const state = controller.getState();
    if (state.kind === "preview") {
      expect(state.recording.blob.size).toBe(MIN_VOICE_RECORDING_BYTES + 32);
    }
  });

  it("rejects tiny recorder output instead of presenting a silent preview", async () => {
    class TinyRecorder extends FakeRecorder {
      override stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array(32)], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    const h = harness({
      createMediaRecorder: vi.fn((_stream, options) => new TinyRecorder(options.mimeType ?? "audio/webm"))
    });
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    controller.stop();

    await vi.waitFor(() => expect(controller.getState().kind).toBe("failed"));
    expect(controller.getState()).toMatchObject({
      kind: "failed",
      code: "recording_interrupted",
      message: "No audio was captured. Try recording again."
    });
  });

  it("moves Stop through processing to a local preview and releases the microphone", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    const states: string[] = [];
    controller.subscribe((state) => states.push(state.kind));
    await controller.start();
    h.advance(2_400);
    controller.stop();

    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    expect(states).toEqual(["requesting_permission", "recording", "recording", "stopping", "processing", "preview"]);
    const state = controller.getState();
    expect(state.kind).toBe("preview");
    if (state.kind === "preview") {
      expect(state.recording.mimeType).toBe("audio/webm;codecs=opus");
      expect(state.recording.durationSeconds).toBeCloseTo(2.4);
      expect(state.recording.objectUrl).toBe("blob:voice-1");
    }
    expect(h.track.stopCount).toBe(1);
  });

  it("generates the optional waveform once for each completed recording", async () => {
    const generateWaveform = vi.fn(async () => Array.from({ length: 48 }, () => 42));
    const h = harness({ generateWaveform });
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);

    await controller.start();
    h.advance(1_000);
    controller.stop();

    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    expect(generateWaveform).toHaveBeenCalledOnce();
    const state = controller.getState();
    if (state.kind === "preview") expect(state.recording.waveform).toHaveLength(48);
  });

  it("keeps a playable preview when waveform decoding fails", async () => {
    const h = harness({ generateWaveform: vi.fn(async () => Promise.reject(new Error("decode failed"))) });
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    controller.stop();

    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    const state = controller.getState();
    if (state.kind === "preview") {
      expect(state.recording.waveform).toBeNull();
      expect(state.recording.objectUrl).toBe("blob:voice-1");
    }
  });

  it.each(["audio/webm;codecs=opus", "audio/mp4"] as const)(
    "preserves a %s Blob for native preview",
    async (mimeType) => {
      const h = harness({ isTypeSupported: (candidate) => candidate === mimeType });
      const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
      await controller.start();
      controller.stop();
      await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
      const state = controller.getState();
      if (state.kind === "preview") {
        expect(state.recording.mimeType).toBe(mimeType);
        expect(state.recording.blobMimeType).toBe(mimeType);
        expect(state.recording.blob.type).toBe(mimeType);
      }
    }
  );

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["NotFoundError", "microphone_unavailable"],
    ["NotReadableError", "microphone_busy"]
  ])("maps %s without exposing raw browser errors", async (name, code) => {
    const h = harness({ getUserMedia: vi.fn(async () => Promise.reject({ name })) });
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    expect(controller.getState()).toMatchObject({ kind: "failed", code });
  });

  it("handles constructor and runtime recorder failures", async () => {
    const constructorHarness = harness({ createMediaRecorder: vi.fn(() => { throw { name: "NotSupportedError" }; }) });
    const constructorController = new VoiceRecorderController(
      { enabled: true, maxDurationSeconds: 60 },
      constructorHarness.runtime
    );
    await constructorController.start();
    expect(constructorController.getState()).toMatchObject({ kind: "failed", code: "recording_unsupported" });
    expect(constructorHarness.track.stopCount).toBe(1);

    const runtimeHarness = harness();
    const runtimeController = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, runtimeHarness.runtime);
    await runtimeController.start();
    runtimeHarness.recorders[0].fail();
    expect(runtimeController.getState()).toMatchObject({ kind: "failed", code: "recording_interrupted" });
    expect(runtimeHarness.track.stopCount).toBe(1);
  });

  it("cancels, revokes previews, and cleans up re-recording", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    h.advance(1_000);
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    expect(h.revoked).toEqual([]);
    await controller.rerecord();
    expect(h.revoked).toEqual(["blob:voice-1"]);
    expect(controller.getState().kind).toBe("recording");
    controller.cancel();
    expect(controller.getState().kind).toBe("idle");
    expect(h.track.stopCount).toBeGreaterThanOrEqual(2);
  });

  it("stops at the projected duration limit without discarding the recording", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    h.advance(60_100);
    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    const state = controller.getState();
    expect(state.kind).toBe("preview");
    if (state.kind === "preview") expect(state.recording.durationSeconds).toBe(60);
  });

  it("finalizes conservatively when the track ends or the page becomes hidden", async () => {
    const ended = harness();
    const endedController = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, ended.runtime);
    await endedController.start();
    ended.advance(500);
    ended.track.endUnexpectedly();
    await vi.waitFor(() => expect(endedController.getState().kind).toBe("preview"));

    const hidden = harness();
    const hiddenController = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, hidden.runtime);
    await hiddenController.start();
    hidden.advance(500);
    hiddenController.handleVisibilityChange(true);
    await vi.waitFor(() => expect(hiddenController.getState().kind).toBe("preview"));
  });

  it("cleans tracks and object URLs on unmount/page discard", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().kind).toBe("preview"));
    controller.handlePageHide();
    expect(h.revoked).toEqual(["blob:voice-1"]);
    expect(h.track.stopCount).toBe(1);
  });
});

describe("Phase 4B boundaries and canonical limits", () => {
  it("gets Free, Plus, and Pro durations from canonical messaging rules", () => {
    expect(messagingLimitsFor("free").maxVoiceNoteSeconds).toBe(300);
    expect(messagingLimitsFor("buddy_plus").maxVoiceNoteSeconds).toBe(300);
    expect(messagingLimitsFor("buddy_pro").maxVoiceNoteSeconds).toBe(300);
  });

  it("projects entitlements server-side and never uploads or sends audio", () => {
    const actions = stripComments(readFileSync(join(process.cwd(), "app/(app)/messaging-actions.ts"), "utf8"));
    const composer = stripComments(readFileSync(join(process.cwd(), "components/messaging/message-composer-v3.tsx"), "utf8"));
    const recorder = stripComments(readFileSync(join(process.cwd(), "lib/messaging/voice-recording.ts"), "utf8"));
    const hook = stripComments(readFileSync(join(process.cwd(), "hooks/use-voice-recorder.ts"), "utf8"));

    expect(actions).toContain("resolveUserEntitlements");
    expect(actions).toContain("entitlements.max_voice_note_seconds");
    expect(composer).toMatch(/aria-label="Tap to record[^"]*"/);
    // The composer orchestrates the canonical recorder; it never uploads or
    // records on its own.
    expect(composer).toContain("useVoiceRecorder(");
    expect(composer).toContain("useVoiceUpload(");
    expect(composer).not.toContain("getUserMedia");
    expect(composer).not.toContain("new MediaRecorder");
    expect(composer).not.toContain("uploadVoice");
    expect(composer).not.toContain("sendVoiceMessage");
    expect(composer).not.toContain('formData.append("voice"');
    expect(recorder).not.toMatch(/fetch\(|supabase|sendMessageAction|upload/);
    expect(hook).toContain('window.addEventListener("pagehide"');
    expect(hook).toContain("controller.destroy()");
  });

  it("keeps image composition and typed text intact", () => {
    const composer = readFileSync(join(process.cwd(), "components/messaging/message-composer-v3.tsx"), "utf8");
    expect(composer).toContain("<AttachmentPicker");
    expect(composer).toContain('const [draft, setDraft] = useState("")');
    expect(composer).not.toContain("setDraft(\"\");\n    voice");
  });

  it("keeps framing and unrelated Permissions Policy restrictions closed", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain("camera=(self), microphone=(self), payment=(), usb=()");
    expect(config).toContain('{ key: "X-Frame-Options", value: "DENY" }');
  });

  it("maps AbortError and SecurityError safely", () => {
    expect(recorderError({ name: "AbortError" }).code).toBe("microphone_busy");
    expect(recorderError({ name: "SecurityError" }).code).toBe("permission_denied");
  });
});
