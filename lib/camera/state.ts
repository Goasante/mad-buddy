import type {
  CameraCaptureMode,
  CameraFacingMode,
  CameraFailureReason,
  CameraSessionState,
  LocalCameraMedia
} from "@/lib/camera/types";

export const initialCameraState: CameraSessionState = {
  status: "idle",
  facingMode: "environment",
  canFlip: false,
  torchAvailable: false,
  torchEnabled: false,
  recordingSeconds: 0,
  media: null,
  error: null,
  captureMode: "photo"
};

export type CameraAction =
  | { type: "request" }
  | { type: "start"; facingMode: CameraFacingMode; switching?: boolean }
  | { type: "ready"; canFlip: boolean; torchAvailable: boolean }
  | { type: "capture" }
  | { type: "video_prepare" }
  | { type: "video_record" }
  | { type: "video_tick"; seconds: number }
  | { type: "video_stop" }
  | { type: "video_process" }
  | { type: "video_cancel" }
  | { type: "review"; media: LocalCameraMedia }
  | { type: "edit_image" }
  | { type: "retake" }
  | { type: "complete" }
  | { type: "torch"; enabled: boolean }
  | { type: "capture_mode"; mode: CameraCaptureMode }
  | { type: "fail"; reason: CameraFailureReason }
  | { type: "close" };

export function cameraReducer(state: CameraSessionState, action: CameraAction): CameraSessionState {
  switch (action.type) {
    case "request":
      return { ...state, status: "requesting_permission", error: null };
    case "start":
      return {
        ...state,
        status: action.switching ? "switching_camera" : "starting",
        facingMode: action.facingMode,
        torchAvailable: false,
        torchEnabled: false,
        error: null
      };
    case "ready":
      return { ...state, status: "ready", canFlip: action.canFlip, torchAvailable: action.torchAvailable };
    case "capture":
      return { ...state, status: "capturing_photo", error: null };
    case "video_prepare":
      return { ...state, status: "preparing_video", recordingSeconds: 0, error: null };
    case "video_record":
      return { ...state, status: "recording_video", recordingSeconds: 0, error: null };
    case "video_tick":
      return { ...state, recordingSeconds: action.seconds };
    case "video_stop":
      return { ...state, status: "stopping_video" };
    case "video_process":
      return { ...state, status: "processing_video" };
    case "video_cancel":
      return { ...state, status: "ready", recordingSeconds: 0, error: null };
    case "review":
      return { ...state, status: "reviewing", media: action.media, recordingSeconds: 0, error: null };
    case "edit_image":
      return state.media?.kind === "image" ? { ...state, status: "editing_image", error: null } : state;
    case "retake":
      return { ...state, status: "starting", media: null, recordingSeconds: 0, error: null };
    case "complete":
      return { ...state, status: "completed" };
    case "torch":
      return { ...state, torchEnabled: action.enabled };
    case "capture_mode": {
      // Refused mid-recording. Switching modes while the recorder is running
      // would leave the shutter showing "photo" over an active clip, and the
      // stop control would disappear from under the user's thumb.
      const busy =
        state.status === "preparing_video" ||
        state.status === "recording_video" ||
        state.status === "stopping_video" ||
        state.status === "processing_video";
      if (busy || state.captureMode === action.mode) return state;
      return { ...state, captureMode: action.mode };
    }
    case "fail":
      return { ...state, status: "failed", error: action.reason, torchEnabled: false, recordingSeconds: 0 };
    case "close":
      return { ...state, status: "closing", torchEnabled: false };
  }
}
