import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const shell = read("components/app-shell/app-shell.tsx");
const orb = read("components/app-shell/mad-buddy-orb.tsx");
const camera = read("components/camera/camera-composer.tsx");
const config = read("next.config.ts");

describe("Home reselect camera architecture", () => {
  it("keeps inactive Home as a real navigation and opens camera only when Home is active", () => {
    expect(orb).toContain("if (!isActive) return;");
    expect(orb).toContain("onHomeReselect?.()");
    expect(shell).toContain("if (pathname === ORB_HOME_HREF) setCameraOpen(true)");
    expect(shell).toContain("item.href !== ORB_HOME_HREF || !isActive");
  });

  it("lazy-loads the camera instead of adding it to ordinary Home rendering", () => {
    expect(shell).toContain("const LazyCameraComposer = dynamic(");
    expect(shell).toContain('ssr: false');
    expect(shell).toContain("cameraOpen ? <LazyCameraComposer");
    expect(stripComments(read("components/dashboard/dashboard-page.tsx"))).not.toContain("getUserMedia");
  });

  it("preserves Home in the persistent shell and uses history for Back", () => {
    expect(camera).toContain("window.history.pushState");
    expect(camera).toContain('window.addEventListener("popstate"');
    expect(camera).toContain("window.history.back()");
    expect(camera).toContain("window.history.go(-historyDepth)");
  });
});

describe("camera permission, privacy and lifecycle", () => {
  it("allows same-origin camera without loosening unrelated permissions", () => {
    expect(config).toContain("geolocation=(self), camera=(self), microphone=(self), payment=(), usb=()");
  });

  it("starts the rear preview without audio and defers microphone access to a hold gesture", () => {
    expect(camera).toContain('facingMode: { ideal: facingMode }');
    expect(camera).toContain("audio: false");
    expect(camera).toContain('void startCamera("environment")');
    expect(camera).toContain("Microphone permission is deferred until the deliberate hold gesture");
    expect(camera).toContain("getUserMedia({ audio: true, video: false })");
  });

  it("stops streams on close, Back, page discard, replacement and unmount", () => {
    expect(camera).toContain('window.addEventListener("pagehide", handlePageHide)');
    expect(camera).toContain('window.addEventListener("popstate", handlePopState)');
    expect(camera).toContain("stream?.getTracks().forEach((track) => track.stop())");
    expect(camera).toContain("return () => {");
  });

  it("keeps capture local and creates no upload or media asset", () => {
    const productionCamera = stripComments(camera);
    for (const banned of ["supabase", "upload", "media_assets", "fetch(", "server action"]) {
      expect(productionCamera.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("camera shell UX", () => {
  it("has safe-area-aware full-screen chrome", () => {
    expect(camera).toContain("env(safe-area-inset-top,0px)");
    expect(camera).toContain("env(safe-area-inset-bottom,0px)");
  });

  it("has no DEAD effects control -- the button must open a real tray", () => {
    // This assertion used to require the Effects button to be ABSENT, because
    // at the time it existed and did nothing. Slice 2 wires it to the shipped
    // effects engine, so the rule is now what it always meant: if the control
    // is present, it must be connected to something.
    const hasButton = camera.includes('aria-label="Effects"');
    if (!hasButton) return;
    expect(camera).toContain('toggleTray("effects")');
    expect(camera).toContain('openTray === "effects"');
    expect(camera).toContain("MAD_EFFECTS");
  });

  it.each([
    "Close camera",
    "Flip camera",
    "Turn torch on",
    "Choose photo from library",
    "Take photo or hold to record video",
    "Photo preview"
  ])("provides the accessible label %s", (label) => {
    expect(camera).toContain(label);
  });

  it("hides flip and torch unless their real capabilities exist", () => {
    expect(camera).toContain("state.torchAvailable ? (");
    expect(camera).toContain("state.canFlip ? (");
  });

  it("implements shared photo/video review and local completion", () => {
    expect(camera).toContain('state.media?.kind === "video" ? "video" : "photo"');
    expect(camera).toContain("Retake");
    expect(camera).toContain("Photo ready for editing");
    expect(camera).toContain("MediaRecorder");
    expect(camera).toContain("Tap for photo");
    expect(camera).toContain("hold for video");
    expect(camera).toContain("MAX_CAMERA_VIDEO_SECONDS");
  });

  it("uses pointer hold semantics, a hard duration cap and one finalized mobile-safe container", () => {
    expect(camera).toContain("handleShutterPointerDown");
    expect(camera).toContain("handleShutterPointerUp");
    expect(camera).toContain("holdTimerRef.current = setTimeout");
    expect(camera).toContain("recorder.start();");
    expect(camera).toContain("MAX_CAMERA_VIDEO_SECONDS * 1_000");
    expect(camera).toContain("scheduleVideoFinalization");
  });

  it("cleans recording resources through the same stream lifecycle as photo capture", () => {
    expect(camera).toContain("videoCleanupRef.current()");
    expect(camera).toContain("active.audioStream.getTracks().forEach((track) => track.stop())");
    expect(camera).toContain("cancelVideoResources()");
  });
});
