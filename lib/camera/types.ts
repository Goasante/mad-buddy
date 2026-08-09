export type CameraFacingMode = "environment" | "user";

export type CameraFailureReason =
  | "insecure_context"
  | "unsupported"
  | "no_camera"
  | "permission_denied"
  | "camera_busy"
  | "stream_ended"
  | "switch_failed"
  | "capture_failed"
  | "microphone_denied"
  | "recording_unsupported"
  | "recording_failed"
  | "recording_too_large"
  | "library_failed";

export type CameraStatus =
  | "idle"
  | "requesting_permission"
  | "starting"
  | "ready"
  | "capturing_photo"
  | "preparing_video"
  | "recording_video"
  | "stopping_video"
  | "processing_video"
  | "switching_camera"
  | "reviewing"
  | "editing_image"
  | "completed"
  | "failed"
  | "closing";

/** Local-only handoff for later editor phases. It contains no storage id. */
type LocalCameraMediaBase = {
  source: "camera" | "library";
  blob: Blob;
  file: File;
  mime: string;
  width: number;
  height: number;
  objectUrl: string;
};

export type LocalCameraImage = LocalCameraMediaBase & {
  kind: "image";
  /** True when front-camera pixels were already mirrored into the captured bitmap. */
  pixelsMirrored?: boolean;
};

export type LocalCameraVideo = LocalCameraMediaBase & {
  kind: "video";
  source: "camera";
  durationSeconds: number;
  /** Front-camera video remains unmodified locally; presentation mirrors it. */
  mirrored: boolean;
};

export type LocalCameraMedia = LocalCameraImage | LocalCameraVideo;

export type CameraCapabilities = {
  secureContext: boolean;
  mediaDevices: boolean;
  getUserMedia: boolean;
  videoInputCount: number;
  canFlip: boolean;
  mediaRecorder: boolean;
  limitation: "insecure_context" | "unsupported" | "no_camera" | null;
};

export type CameraSessionState = {
  status: CameraStatus;
  facingMode: CameraFacingMode;
  canFlip: boolean;
  torchAvailable: boolean;
  torchEnabled: boolean;
  recordingSeconds: number;
  media: LocalCameraMedia | null;
  error: CameraFailureReason | null;
};
