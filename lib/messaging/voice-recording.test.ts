import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  detectVoiceRecordingCapability,
  recorderError,
  VoiceRecorderController,
  type MediaRecorderLike,
  type VoiceRecordingRuntime
} from "@/lib/messaging/voice-recording";
import { messagingLimitsFor } from "@/lib/messaging/rules";
import { stripComments } from "@/lib/content/strip-comments";

class FakeTrack {
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

  constructor(mimeType: string) {
    this.mimeType = mimeType;
  }

  start() {
    this.startCount += 1;
    this.state = "recording";
  }

  stop() {
    this.stopCount += 1;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
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
  const stream = { getTracks: () => [track as unknown as MediaStreamTrack] } as MediaStream;
  const recorders: FakeRecorder[] = [];
  const intervals = new Map<number, () => void>();
  const revoked: string[] = [];
  let nextInterval = 1;
  let nextUrl = 1;

  const runtime: VoiceRecordingRuntime = {
    secureContext: true,
    getUserMedia: vi.fn(async () => stream),
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
    createObjectURL: () => `blob:voice-${nextUrl++}`,
    revokeObjectURL: (url) => revoked.push(url),
    ...overrides
  };

  return {
    runtime,
    track,
    recorders,
    revoked,
    advance(ms: number) {
      nowMs += ms;
      for (const callback of [...intervals.values()]) callback();
    }
  };
}

describe("voice recording capability", () => {
  it("prefers WebM/Opus", () => {
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
    expect(controller.getState().kind).toBe("recording");
  });

  it("moves Stop through processing to a local preview and releases the microphone", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    const states: string[] = [];
    controller.subscribe((state) => states.push(state.kind));
    await controller.start();
    h.advance(2_400);
    controller.stop();

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
    expect(constructorController.getState()).toMatchObject({ kind: "failed", code: "recording_interrupted" });
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
    expect(controller.getState().kind).toBe("preview");
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
    expect(endedController.getState().kind).toBe("preview");

    const hidden = harness();
    const hiddenController = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, hidden.runtime);
    await hiddenController.start();
    hidden.advance(500);
    hiddenController.handleVisibilityChange(true);
    expect(hiddenController.getState().kind).toBe("preview");
  });

  it("cleans tracks and object URLs on unmount/page discard", async () => {
    const h = harness();
    const controller = new VoiceRecorderController({ enabled: true, maxDurationSeconds: 60 }, h.runtime);
    await controller.start();
    controller.stop();
    controller.handlePageHide();
    expect(h.revoked).toEqual(["blob:voice-1"]);
    expect(h.track.stopCount).toBe(1);
  });
});

describe("Phase 4B boundaries and canonical limits", () => {
  it("gets Free, Plus, and Pro durations from canonical messaging rules", () => {
    expect(messagingLimitsFor("free").maxVoiceNoteSeconds).toBe(60);
    expect(messagingLimitsFor("buddy_plus").maxVoiceNoteSeconds).toBe(300);
    expect(messagingLimitsFor("buddy_pro").maxVoiceNoteSeconds).toBe(300);
  });

  it("projects entitlements server-side and never uploads or sends audio", () => {
    const actions = stripComments(readFileSync(join(process.cwd(), "app/(app)/messaging-actions.ts"), "utf8"));
    const composer = stripComments(readFileSync(join(process.cwd(), "components/messaging/message-composer.tsx"), "utf8"));
    const recorder = stripComments(readFileSync(join(process.cwd(), "lib/messaging/voice-recording.ts"), "utf8"));
    const hook = stripComments(readFileSync(join(process.cwd(), "hooks/use-voice-recorder.ts"), "utf8"));

    expect(actions).toContain("resolveUserEntitlements");
    expect(actions).toContain("entitlements.max_voice_note_seconds");
    expect(composer).toContain('aria-label="Record voice message"');
    expect(composer).toContain("voiceBlocksSend");
    expect(composer).not.toContain("uploadVoice");
    expect(composer).not.toContain("sendVoiceMessage");
    expect(composer).not.toContain('formData.append("voice"');
    expect(recorder).not.toMatch(/fetch\(|supabase|sendMessageAction|upload/);
    expect(hook).toContain('window.addEventListener("pagehide"');
    expect(hook).toContain("controller.destroy()");
  });

  it("keeps image composition and typed text intact", () => {
    const composer = readFileSync(join(process.cwd(), "components/messaging/message-composer.tsx"), "utf8");
    expect(composer).toContain("<AttachmentPicker");
    expect(composer).toContain('const [draft, setDraft] = useState("")');
    expect(composer).not.toContain("setDraft(\"\");\n    voice");
  });

  it("keeps framing and unrelated Permissions Policy restrictions closed", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain("camera=(), microphone=(self), payment=(), usb=()");
    expect(config).toContain('{ key: "X-Frame-Options", value: "DENY" }');
  });

  it("maps AbortError and SecurityError safely", () => {
    expect(recorderError({ name: "AbortError" }).code).toBe("microphone_busy");
    expect(recorderError({ name: "SecurityError" }).code).toBe("permission_denied");
  });
});
