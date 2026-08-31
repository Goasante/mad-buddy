import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { cameraReducer, initialCameraState } from "@/lib/camera/state";
import { MAD_EFFECTS } from "@/lib/camera/effect-registry";
import type { CameraSessionState } from "@/lib/camera/types";

/**
 * Mad Cam Slice 2: capture modes, trays and the shared recorder.
 *
 * The reducer is pure, so the mode rules are exercised as real behaviour.
 * The composer is a client component and vitest runs environment "node", so
 * its wiring is asserted against source -- the pattern used throughout this
 * codebase for client-only paths.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const camera = stripComments(read("components/camera/camera-composer.tsx"));

const ready = (overrides: Partial<CameraSessionState> = {}): CameraSessionState => ({
  ...initialCameraState,
  status: "ready",
  ...overrides
});

// ---------------------------------------------------------------------------
// Capture mode — real reducer behaviour
// ---------------------------------------------------------------------------

describe("capture mode", () => {
  it("starts in photo mode, preserving the existing default", () => {
    expect(initialCameraState.captureMode).toBe("photo");
  });

  it("switches between photo and video", () => {
    const video = cameraReducer(ready(), { type: "capture_mode", mode: "video" });
    expect(video.captureMode).toBe("video");
    expect(cameraReducer(video, { type: "capture_mode", mode: "photo" }).captureMode).toBe("photo");
  });

  it("is a no-op when the mode is already active", () => {
    const state = ready();
    expect(cameraReducer(state, { type: "capture_mode", mode: "photo" })).toBe(state);
  });

  it.each(["preparing_video", "recording_video", "stopping_video", "processing_video"] as const)(
    "refuses to switch mode while %s",
    (status) => {
      const state = ready({ status, captureMode: "video" });
      const next = cameraReducer(state, { type: "capture_mode", mode: "photo" });
      // Same object back: switching mid-clip would strand the stop control.
      expect(next).toBe(state);
      expect(next.captureMode).toBe("video");
    }
  );

  it("does not disturb anything else about the session", () => {
    const state = ready({ facingMode: "user", torchAvailable: true, torchEnabled: true, canFlip: true });
    const next = cameraReducer(state, { type: "capture_mode", mode: "video" });
    expect(next.facingMode).toBe("user");
    expect(next.torchEnabled).toBe(true);
    expect(next.canFlip).toBe(true);
    expect(next.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// One recorder, two affordances
// ---------------------------------------------------------------------------

describe("both modes drive the same recorder", () => {
  it("has exactly one recording entry point", () => {
    // Two call sites (photo hold-timer, video tap) but ONE function, and no
    // second MediaRecorder construction anywhere.
    expect((camera.match(/const startVideoRecording = useCallback/g) ?? []).length).toBe(1);
    expect((camera.match(/new Recorder\(/g) ?? []).length).toBe(1);
  });

  it("starts recording from the hold timer in photo mode", () => {
    expect(camera).toContain("HOLD_TO_RECORD_MS");
    expect(camera).toContain("void startVideoRecording();");
  });

  it("starts and stops recording on tap in video mode", () => {
    const handler = camera.slice(
      camera.indexOf("function handleShutterPointerDown"),
      camera.indexOf("function handleShutterPointerUp")
    );
    expect(handler).toContain('state.captureMode === "video"');
    expect(handler).toContain("stopVideoRecording();");
    expect(handler).toContain("void startVideoRecording();");
  });

  it("does not stop a video-mode recording when the finger lifts", () => {
    // The whole point of tap-to-start: releasing must not end the clip.
    const up = camera.slice(
      camera.indexOf("function handleShutterPointerUp"),
      camera.indexOf("function handleShutterPointerCancel")
    );
    const videoBranch = up.slice(up.indexOf('state.captureMode === "video"'));
    expect(videoBranch.slice(0, 120)).toContain("return;");
  });

  it("only applies the hold-abort guard in photo mode", () => {
    // A video-mode tap has no hold to release, so the guard that abandons a
    // recording when the finger lifts must not fire there.
    expect(camera).toContain('captureModeRef.current === "photo" && !holdActiveRef.current');
  });

  it("reads the mode from a ref in the async recorder path", () => {
    // `state` is stale after awaiting the microphone prompt.
    expect(camera).toContain("captureModeRef.current = state.captureMode;");
  });
});

// ---------------------------------------------------------------------------
// Trays — progressive disclosure
// ---------------------------------------------------------------------------

describe("trays", () => {
  it("keeps at most one tray open", () => {
    // Single nullable value, not a set of independent booleans.
    expect(camera).toContain("useState<CameraTrayId | null>(null)");
    expect(camera).toContain("setOpenTray((current) => (current === tray ? null : tray))");
  });

  it("closes trays when the capture mode changes", () => {
    const select = camera.slice(camera.indexOf("const selectCaptureMode"));
    expect(select.slice(0, 260)).toContain("setOpenTray(null)");
  });

  it("renders the effects rail only when its tray is open", () => {
    expect(camera).toContain('openTray === "effects" ? (');
  });

  it("marks the tray control's state for assistive technology", () => {
    expect(camera).toContain('aria-expanded={openTray === "effects"}');
  });
});

// ---------------------------------------------------------------------------
// Honest capability gating (Slice 2 §7, §8)
// ---------------------------------------------------------------------------

describe("no fake modes or capabilities", () => {
  it.each(["boomerang", "slow motion", "slowmo", "time lapse", "timelapse", "reverse", "AI beauty"])(
    "does not expose %s",
    (banned) => {
      expect(camera.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  );

  it("offers only photo and video as capture modes", () => {
    const strip = camera.slice(camera.indexOf("camera-mode-strip"));
    expect(strip).toContain('(["photo", "video"] as const)');
  });

  it("gates torch on the real hardware capability", () => {
    expect(camera).toContain("trackSupportsTorch");
    expect(camera).toContain("state.torchAvailable ? (");
    // Real constraint, not a screen-whitening imitation of a flash.
    expect(camera).toContain("advanced: [{ torch: enabled }");
  });

  it("gates flip on a real second camera", () => {
    expect(camera).toContain("state.canFlip ? (");
  });

  it("filters effects by what the device can actually render", () => {
    expect(camera).toContain("canRenderEffect(effect, effectCapabilities)");
    expect(MAD_EFFECTS.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle and accessibility
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("guards against overlapping camera flips", () => {
    expect(camera).toContain("flipInFlightRef.current");
    const flip = camera.slice(camera.indexOf("async function flipCamera"));
    expect(flip.slice(0, 500)).toContain("finally");
  });

  it("stops tracks and revokes object URLs on teardown", () => {
    expect(camera).toContain("stream?.getTracks().forEach((track) => track.stop())");
    expect(camera).toContain("URL.revokeObjectURL");
  });

  it("cancels the effect animation frame", () => {
    expect(camera).toContain("cancelAnimationFrame");
  });
});

describe("accessibility", () => {
  it("labels the shutter for the mode it is in", () => {
    expect(camera).toContain('"Stop recording"');
    expect(camera).toContain('"Start recording video"');
    expect(camera).toContain('"Take photo or hold to record video"');
  });

  it("states recording in words, not by colour alone", () => {
    expect(camera).toContain("camera-recording-label");
    expect(camera).toContain(">Recording<");
  });

  it("exposes the mode strip as a radio group", () => {
    expect(camera).toContain('role="radiogroup"');
    expect(camera).toContain("aria-checked={state.captureMode === mode}");
  });
});
