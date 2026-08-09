import { describe, expect, it, vi } from "vitest";
import { cameraFailureFromException, detectCameraCapabilities } from "@/lib/camera/capabilities";

const device = (kind: MediaDeviceKind): MediaDeviceInfo => ({
  deviceId: "device",
  groupId: "group",
  kind,
  label: "",
  toJSON: () => ({})
});

describe("camera capability detection", () => {
  it("does not call getUserMedia while detecting ordinary Home capabilities", async () => {
    const getUserMedia = vi.fn();
    await detectCameraCapabilities({
      secureContext: true,
      mediaDevices: { getUserMedia, enumerateDevices: vi.fn(async () => [device("videoinput")]) },
      mediaRecorderAvailable: true
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("reports insecure and unsupported environments safely", async () => {
    await expect(detectCameraCapabilities({ secureContext: false, mediaRecorderAvailable: false })).resolves.toMatchObject({
      limitation: "insecure_context",
      getUserMedia: false
    });
    await expect(detectCameraCapabilities({ secureContext: true, mediaRecorderAvailable: false })).resolves.toMatchObject({
      limitation: "unsupported"
    });
  });

  it("detects one camera versus a flippable pair without using labels", async () => {
    const one = await detectCameraCapabilities({
      secureContext: true,
      mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => [device("videoinput")]) },
      mediaRecorderAvailable: false
    });
    const two = await detectCameraCapabilities({
      secureContext: true,
      mediaDevices: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn(async () => [device("videoinput"), device("audioinput"), device("videoinput")])
      },
      mediaRecorderAvailable: true
    });
    expect(one.canFlip).toBe(false);
    expect(two).toMatchObject({ canFlip: true, videoInputCount: 2, mediaRecorder: true });
  });

  it("normalizes permission and busy failures without exposing raw errors", () => {
    expect(cameraFailureFromException({ name: "NotAllowedError" })).toBe("permission_denied");
    expect(cameraFailureFromException({ name: "NotReadableError" })).toBe("camera_busy");
    expect(cameraFailureFromException({ name: "NotFoundError" })).toBe("no_camera");
  });
});
