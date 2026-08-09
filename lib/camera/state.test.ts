import { describe, expect, it } from "vitest";
import { cameraReducer, initialCameraState } from "@/lib/camera/state";
import type { LocalCameraMedia } from "@/lib/camera/types";

const media: LocalCameraMedia = {
  kind: "image",
  source: "camera",
  blob: new Blob(["photo"], { type: "image/jpeg" }),
  file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
  mime: "image/jpeg",
  width: 1200,
  height: 900,
  objectUrl: "blob:local"
};

describe("canonical camera state machine", () => {
  it("moves through permission, rear-camera start, ready, capture, review and completion", () => {
    const requested = cameraReducer(initialCameraState, { type: "request" });
    const starting = cameraReducer(requested, { type: "start", facingMode: "environment" });
    const ready = cameraReducer(starting, { type: "ready", canFlip: true, torchAvailable: true });
    const capturing = cameraReducer(ready, { type: "capture" });
    const review = cameraReducer(capturing, { type: "review", media });
    const completed = cameraReducer(review, { type: "complete" });
    expect([requested.status, starting.status, ready.status, capturing.status, review.status, completed.status]).toEqual([
      "requesting_permission",
      "starting",
      "ready",
      "capturing_photo",
      "reviewing",
      "completed"
    ]);
    expect(ready.facingMode).toBe("environment");
  });

  it("models switching, torch and failure without scattered flags", () => {
    const switching = cameraReducer(initialCameraState, { type: "start", facingMode: "user", switching: true });
    const ready = cameraReducer(switching, { type: "ready", canFlip: true, torchAvailable: true });
    const torch = cameraReducer(ready, { type: "torch", enabled: true });
    const failed = cameraReducer(torch, { type: "fail", reason: "stream_ended" });
    expect(switching.status).toBe("switching_camera");
    expect(torch.torchEnabled).toBe(true);
    expect(failed).toMatchObject({ status: "failed", error: "stream_ended", torchEnabled: false });
  });

  it("models the hold-video lifecycle before handing off to the shared review state", () => {
    const ready = cameraReducer(initialCameraState, {
      type: "ready",
      canFlip: true,
      torchAvailable: false
    });
    const preparing = cameraReducer(ready, { type: "video_prepare" });
    const recording = cameraReducer(preparing, { type: "video_record" });
    const ticked = cameraReducer(recording, { type: "video_tick", seconds: 3.2 });
    const stopping = cameraReducer(ticked, { type: "video_stop" });
    const processing = cameraReducer(stopping, { type: "video_process" });
    expect([
      preparing.status,
      recording.status,
      stopping.status,
      processing.status
    ]).toEqual(["preparing_video", "recording_video", "stopping_video", "processing_video"]);
    expect(ticked.recordingSeconds).toBe(3.2);
    expect(cameraReducer(preparing, { type: "video_cancel" }).status).toBe("ready");
  });

  it("enters image editing only from an image review", () => {
    const review = cameraReducer(initialCameraState, { type: "review", media });
    expect(cameraReducer(review, { type: "edit_image" }).status).toBe("editing_image");
  });
});
