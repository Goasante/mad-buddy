import { describe, expect, it, vi } from "vitest";
import {
  baseVideoMime,
  cameraVideoError,
  localVideoFromChunks,
  MAX_CAMERA_VIDEO_SECONDS,
  selectCameraVideoMime
} from "@/lib/camera/video-recording";

describe("camera video recording foundation", () => {
  it("selects one interoperable supported container without assuming MediaRecorder support", () => {
    expect(selectCameraVideoMime(undefined)).toBeNull();
    expect(selectCameraVideoMime((mime) => mime === "video/mp4")).toBe("video/mp4");
    expect(selectCameraVideoMime((mime) => mime === "video/webm;codecs=vp8,opus"))
      .toBe("video/webm;codecs=vp8,opus");
  });

  it("normalizes codec-qualified MIME values for the canonical media pipeline", () => {
    expect(baseVideoMime("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(baseVideoMime("video/mp4;codecs=avc1")).toBe("video/mp4");
    expect(baseVideoMime("application/octet-stream")).toBeNull();
  });

  it("assembles a non-empty WebM into the shared local camera shape", () => {
    const createObjectUrl = vi.fn(() => "blob:local-video");
    const media = localVideoFromChunks({
      chunks: [new Blob([new Uint8Array(2_048)])],
      recorderMime: "video/webm;codecs=vp8,opus",
      selectedMime: "video/webm;codecs=vp8,opus",
      durationSeconds: 2.4,
      width: 1080,
      height: 1920,
      facingMode: "environment",
      createObjectUrl
    });
    expect(media).toMatchObject({
      kind: "video",
      source: "camera",
      mime: "video/webm",
      durationSeconds: 2.4,
      width: 1080,
      height: 1920,
      mirrored: false,
      objectUrl: "blob:local-video"
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });

  it("marks front-camera review as mirrored without rewriting local video bytes", () => {
    const media = localVideoFromChunks({
      chunks: [new Blob([new Uint8Array(2_048)])],
      recorderMime: "video/mp4",
      selectedMime: "video/mp4",
      durationSeconds: 1,
      width: 720,
      height: 1280,
      facingMode: "user",
      createObjectUrl: () => "blob:selfie-video"
    });
    expect(media).toMatchObject({ mime: "video/mp4", mirrored: true });
  });

  it("rejects empty, too-short, unsupported and oversized recordings", () => {
    const base = {
      selectedMime: "video/webm",
      recorderMime: "video/webm",
      width: 640,
      height: 480,
      facingMode: "environment" as const,
      createObjectUrl: () => "blob:unused"
    };
    expect(() => localVideoFromChunks({ ...base, chunks: [], durationSeconds: 1 }))
      .toThrow("recording_failed");
    expect(() => localVideoFromChunks({
      ...base,
      chunks: [new Blob([new Uint8Array(2_048)])],
      durationSeconds: 0.1
    })).toThrow("recording_failed");
    expect(() => localVideoFromChunks({
      ...base,
      selectedMime: "video/unknown",
      recorderMime: "video/unknown",
      chunks: [new Blob([new Uint8Array(2_048)])],
      durationSeconds: 1
    })).toThrow("recording_unsupported");
    expect(() => localVideoFromChunks({
      ...base,
      chunks: [new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])],
      durationSeconds: MAX_CAMERA_VIDEO_SECONDS
    })).toThrow("recording_too_large");
  });

  it("maps microphone and recorder exceptions to safe UI reasons", () => {
    expect(cameraVideoError({ name: "NotAllowedError" })).toBe("microphone_denied");
    expect(cameraVideoError({ name: "NotSupportedError" })).toBe("recording_unsupported");
    expect(cameraVideoError(new Error("recording_too_large"))).toBe("recording_too_large");
    expect(cameraVideoError(new Error("raw-internal-error"))).toBe("recording_failed");
  });
});
