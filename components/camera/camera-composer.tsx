"use client";

import {
  CameraOff,
  Check,
  Edit3,
  Images,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  SwitchCamera,
  X,
  Zap,
  ZapOff
} from "lucide-react";
import dynamic from "next/dynamic";
import {
  forwardRef,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type ReactNode
} from "react";
import {
  cameraFailureFromException,
  detectCameraCapabilities,
  trackSupportsTorch
} from "@/lib/camera/capabilities";
import { canRenderEffect, detectEffectCapabilities, type EffectCapabilities } from "@/lib/camera/effect-capabilities";
import type { EffectInstance } from "@/lib/camera/effect-document";
import { effectInstanceFor, MAD_EFFECTS } from "@/lib/camera/effect-registry";
import { renderImageEffects } from "@/lib/camera/effect-renderer";
import { captureVideoFrame, localMediaFromLibrary } from "@/lib/camera/local-media";
import { cameraReducer, initialCameraState } from "@/lib/camera/state";
import type {
  CameraCaptureMode,
  CameraFacingMode,
  CameraFailureReason,
  LocalCameraMedia
} from "@/lib/camera/types";
import {
  cameraVideoError,
  localVideoFromChunks,
  MAX_CAMERA_VIDEO_SECONDS,
  selectCameraVideoMime
} from "@/lib/camera/video-recording";
import { cn } from "@/lib/utils";

const CAMERA_HISTORY_KEY = "mbCamera";
const REVIEW_HISTORY_KEY = "mbCameraReview";

/**
 * How long a press must last in photo mode before it becomes a recording.
 *
 * Unchanged from the original gesture. Long enough that a normal tap is
 * unambiguously a photo, short enough that the transition feels immediate.
 */
const HOLD_TO_RECORD_MS = 420;

/**
 * The trays. Exactly one may be open, so the live preview is never buried
 * under stacked panels and the shutter stays reachable.
 */
const CAMERA_TRAYS = ["effects", "looks", "more"] as const;
type CameraTrayId = (typeof CAMERA_TRAYS)[number];

const ImageEditor = dynamic(() => import("@/components/camera/image-editor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-[#080706] text-[#FEFBF3]" role="status">
      <Loader2 className="h-7 w-7 animate-spin text-[#FF8A1F] motion-reduce:animate-none" aria-hidden="true" />
      <span className="sr-only">Loading photo editor</span>
    </div>
  )
});

const ERROR_COPY: Record<CameraFailureReason, { title: string; description: string }> = {
  insecure_context: {
    title: "Camera needs a secure connection",
    description: "Open Mad Buddy over HTTPS, or choose a photo from your library."
  },
  unsupported: {
    title: "Camera is not supported here",
    description: "You can still choose a photo from your library."
  },
  no_camera: {
    title: "No camera is available",
    description: "Connect a camera or choose a photo from your library."
  },
  permission_denied: {
    title: "Camera access is off",
    description: "Allow camera access in your browser settings, then try again."
  },
  camera_busy: {
    title: "Camera is being used",
    description: "Close the other app using your camera, then try again."
  },
  stream_ended: {
    title: "Camera stopped",
    description: "Camera access ended. Try starting it again."
  },
  switch_failed: {
    title: "Could not switch cameras",
    description: "Try again, or continue with the current camera."
  },
  capture_failed: {
    title: "Could not take that photo",
    description: "Hold still and try again."
  },
  microphone_denied: {
    title: "Microphone access is off",
    description: "Allow microphone access to record video with sound, or tap to take a photo."
  },
  recording_unsupported: {
    title: "Video recording is not supported here",
    description: "Tap the shutter to take a photo, or choose one from your library."
  },
  recording_failed: {
    title: "That video could not be recorded",
    description: "Keep holding the shutter while recording, then try again."
  },
  recording_too_large: {
    title: "That video is too large",
    description: "Record a shorter clip and try again."
  },
  library_failed: {
    title: "Could not open that photo",
    description: "Choose a JPG, PNG, or WebP image."
  }
};

function cameraConstraints(facingMode: CameraFacingMode): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };
}

type ActiveCameraRecording = {
  recorder: MediaRecorder;
  audioStream: MediaStream;
  chunks: Blob[];
  selectedMime: string;
  startedAt: number;
  width: number;
  height: number;
  facingMode: CameraFacingMode;
  stopReceived: boolean;
  finalized: boolean;
  elapsedTimer: ReturnType<typeof setInterval> | null;
  maximumTimer: ReturnType<typeof setTimeout> | null;
  finalizationTimer: ReturnType<typeof setTimeout> | null;
};

export function CameraComposer({ onClose }: { onClose: () => void }) {
  const [state, dispatch] = useReducer(cameraReducer, initialCameraState);
  const [activeLiveEffect, setActiveLiveEffect] = useState<EffectInstance | null>(null);
  const [effectCapabilities, setEffectCapabilities] = useState<EffectCapabilities | null>(null);
  const [capturedEffect, setCapturedEffect] = useState<EffectInstance | null>(null);
  const live = !state.media && state.status !== "completed";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRecordingRef = useRef<ActiveCameraRecording | null>(null);
  const videoCleanupRef = useRef<() => void>(() => undefined);
  const mediaRef = useRef<LocalCameraMedia | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const intentionalStopRef = useRef(false);
  const streamRequestRef = useRef(0);
  const videoRequestRef = useRef(0);
  const historyDepthRef = useRef(0);
  const stageRef = useRef<"live" | "review">("live");
  const facingModeRef = useRef<CameraFacingMode>("environment");
  const mountedRef = useRef(true);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The capture mode, mirrored into a ref.
   *
   * startVideoRecording awaits the microphone prompt, and by the time it
   * resumes the closed-over `state` is stale. The ref is what that async path
   * reads so it cannot act on a mode the user has since left.
   */
  const captureModeRef = useRef<CameraCaptureMode>("photo");
  /** Which tray is open, if any. Exactly one at a time (Slice 2). */
  const [openTray, setOpenTray] = useState<CameraTrayId | null>(null);
  /** Guards overlapping camera-flip requests (see flipCamera). */
  const flipInFlightRef = useRef(false);
  const holdActiveRef = useRef(false);
  const pointerGestureRef = useRef(false);

  const clearMedia = useCallback(() => {
    reviewVideoRef.current?.pause();
    const media = mediaRef.current;
    if (media) URL.revokeObjectURL(media.objectUrl);
    mediaRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    videoCleanupRef.current();
    streamRequestRef.current += 1;
    intentionalStopRef.current = true;
    const stream = streamRef.current;
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    stream?.getTracks().forEach((track) => track.stop());
    queueMicrotask(() => {
      intentionalStopRef.current = false;
    });
  }, []);

  const startCamera = useCallback(async (facingMode: CameraFacingMode, switching = false) => {
    stopStream();
    const requestId = streamRequestRef.current;
    facingModeRef.current = facingMode;
    if (switching) dispatch({ type: "start", facingMode, switching: true });
    else dispatch({ type: "request" });

    const capabilities = await detectCameraCapabilities();
    if (!mountedRef.current || requestId !== streamRequestRef.current) return;
    if (capabilities.limitation === "insecure_context") {
      dispatch({ type: "fail", reason: "insecure_context" });
      return;
    }
    if (capabilities.limitation === "unsupported") {
      dispatch({ type: "fail", reason: "unsupported" });
      return;
    }

    if (!switching) dispatch({ type: "start", facingMode });
    try {
      // This is the only permission request in C1, and this component is only
      // mounted after an explicit already-on-Home tap.
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(facingMode));
      if (!mountedRef.current || requestId !== streamRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) throw new DOMException("No video input", "NotFoundError");
      videoTrack.addEventListener("ended", () => {
        if (!intentionalStopRef.current && mountedRef.current) {
          videoCleanupRef.current();
          streamRef.current = null;
          dispatch({ type: "fail", reason: "stream_ended" });
        }
      }, { once: true });

      const video = videoRef.current;
      if (!video) throw new Error("camera_preview_missing");
      video.srcObject = stream;
      await video.play();

      let videoInputCount = capabilities.videoInputCount;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoInputCount = devices.filter((device) => device.kind === "videoinput").length;
      } catch {
        // A usable stream is enough. Device labels/count are optional.
      }

      dispatch({
        type: "ready",
        canFlip: videoInputCount > 1,
        torchAvailable: trackSupportsTorch(videoTrack)
      });
    } catch (error) {
      if (requestId !== streamRequestRef.current) return;
      stopStream();
      dispatch({
        type: "fail",
        reason: switching ? "switch_failed" : cameraFailureFromException(error)
      });
    }
  }, [stopStream]);

  const restartCamera = useCallback(() => {
    clearMedia();
    stageRef.current = "live";
    dispatch({ type: "retake" });
    void startCamera(facingModeRef.current);
  }, [clearMedia, startCamera]);

  const returnToCamera = useCallback(() => {
    if (window.history.state?.[REVIEW_HISTORY_KEY]) {
      window.history.back();
      return;
    }
    restartCamera();
  }, [restartCamera]);

  const enterReview = useCallback((media: LocalCameraMedia) => {
    clearMedia();
    mediaRef.current = media;
    if (stageRef.current !== "review") {
      window.history.pushState(
        { ...window.history.state, [CAMERA_HISTORY_KEY]: true, [REVIEW_HISTORY_KEY]: true },
        ""
      );
      historyDepthRef.current += 1;
    }
    stageRef.current = "review";
    dispatch({ type: "review", media });
  }, [clearMedia]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current === null) return;
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const cancelVideoResources = useCallback(() => {
    videoRequestRef.current += 1;
    const active = videoRecordingRef.current;
    videoRecordingRef.current = null;
    if (!active) return;
    if (active.elapsedTimer !== null) clearInterval(active.elapsedTimer);
    if (active.maximumTimer !== null) clearTimeout(active.maximumTimer);
    if (active.finalizationTimer !== null) clearTimeout(active.finalizationTimer);
    active.recorder.ondataavailable = null;
    active.recorder.onstop = null;
    active.recorder.onerror = null;
    if (active.recorder.state !== "inactive") {
      try {
        active.recorder.stop();
      } catch {
        // A recorder may already be stopping after a device interruption.
      }
    }
    active.audioStream.getTracks().forEach((track) => track.stop());
    active.chunks.length = 0;
  }, []);

  useEffect(() => {
    videoCleanupRef.current = () => {
      clearHoldTimer();
      holdActiveRef.current = false;
      cancelVideoResources();
    };
  }, [cancelVideoResources, clearHoldTimer]);

  const completeVideoRecording = useCallback(() => {
    const active = videoRecordingRef.current;
    if (!active || active.finalized) return;
    active.finalized = true;
    if (active.elapsedTimer !== null) clearInterval(active.elapsedTimer);
    if (active.maximumTimer !== null) clearTimeout(active.maximumTimer);
    if (active.finalizationTimer !== null) clearTimeout(active.finalizationTimer);
    active.audioStream.getTracks().forEach((track) => track.stop());
    dispatch({ type: "video_process" });

    try {
      const media = localVideoFromChunks({
        chunks: active.chunks,
        recorderMime: active.recorder.mimeType,
        selectedMime: active.selectedMime,
        durationSeconds: Math.min(
          MAX_CAMERA_VIDEO_SECONDS,
          Math.max(0, (performance.now() - active.startedAt) / 1_000)
        ),
        width: active.width,
        height: active.height,
        facingMode: active.facingMode
      });
      active.recorder.ondataavailable = null;
      active.recorder.onstop = null;
      active.recorder.onerror = null;
      videoRecordingRef.current = null;
      stopStream();
      enterReview(media);
    } catch (error) {
      videoRecordingRef.current = null;
      stopStream();
      dispatch({ type: "fail", reason: cameraVideoError(error) });
    }
  }, [enterReview, stopStream]);

  const scheduleVideoFinalization = useCallback(() => {
    const active = videoRecordingRef.current;
    if (!active || active.finalized) return;
    if (active.finalizationTimer !== null) clearTimeout(active.finalizationTimer);
    // Mobile WebKit may deliver the final dataavailable immediately after
    // stop. A short quiet period ensures the complete MP4 container is used.
    active.finalizationTimer = setTimeout(completeVideoRecording, 75);
  }, [completeVideoRecording]);

  const stopVideoRecording = useCallback(() => {
    const active = videoRecordingRef.current;
    if (!active || active.finalized || active.recorder.state !== "recording") return;
    dispatch({ type: "video_stop" });
    if (active.elapsedTimer !== null) clearInterval(active.elapsedTimer);
    active.elapsedTimer = null;
    if (active.maximumTimer !== null) clearTimeout(active.maximumTimer);
    active.maximumTimer = null;
    try {
      active.recorder.stop();
    } catch (error) {
      cancelVideoResources();
      dispatch({ type: "fail", reason: cameraVideoError(error) });
      return;
    }
    active.audioStream.getTracks().forEach((track) => track.stop());
  }, [cancelVideoResources]);

  const startVideoRecording = useCallback(async () => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    const video = videoRef.current;
    const Recorder = globalThis.MediaRecorder;
    const selectedMime = Recorder?.isTypeSupported
      ? selectCameraVideoMime((mime) => Recorder.isTypeSupported(mime))
      : null;
    if (!videoTrack || videoTrack.readyState !== "live" || !video || !Recorder || !selectedMime) {
      dispatch({ type: "fail", reason: "recording_unsupported" });
      return;
    }

    const requestId = ++videoRequestRef.current;
    dispatch({ type: "video_prepare" });
    let audioStream: MediaStream;
    try {
      // Microphone permission is deferred until the deliberate hold gesture.
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      if (!mountedRef.current || requestId !== videoRequestRef.current) return;
      dispatch({ type: "fail", reason: cameraVideoError(error) });
      return;
    }

    if (!mountedRef.current || requestId !== videoRequestRef.current) {
      audioStream.getTracks().forEach((track) => track.stop());
      return;
    }
    // In PHOTO mode the recording only exists for as long as the finger is
    // down, so a hold released during the microphone prompt must abandon it.
    // In VIDEO mode the tap already committed to recording and there is no
    // hold to release, so this gate does not apply -- same recorder, one
    // guard that understands both entry points.
    if (captureModeRef.current === "photo" && !holdActiveRef.current) {
      audioStream.getTracks().forEach((track) => track.stop());
      dispatch({ type: "video_cancel" });
      return;
    }

    const audioTrack = audioStream.getAudioTracks()[0];
    if (!audioTrack || !audioTrack.enabled || audioTrack.muted || audioTrack.readyState !== "live") {
      audioStream.getTracks().forEach((track) => track.stop());
      dispatch({ type: "fail", reason: "recording_failed" });
      return;
    }

    let recorder: MediaRecorder;
    try {
      const recordingStream = new MediaStream([videoTrack, audioTrack]);
      recorder = new Recorder(recordingStream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 2_000_000,
        audioBitsPerSecond: 64_000
      });
    } catch (error) {
      audioStream.getTracks().forEach((track) => track.stop());
      dispatch({ type: "fail", reason: cameraVideoError(error) });
      return;
    }

    const active: ActiveCameraRecording = {
      recorder,
      audioStream,
      chunks: [],
      selectedMime,
      startedAt: performance.now(),
      width: video.videoWidth,
      height: video.videoHeight,
      facingMode: facingModeRef.current,
      stopReceived: false,
      finalized: false,
      elapsedTimer: null,
      maximumTimer: null,
      finalizationTimer: null
    };
    videoRecordingRef.current = active;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) active.chunks.push(event.data);
      if (active.stopReceived) scheduleVideoFinalization();
    };
    recorder.onstop = () => {
      active.stopReceived = true;
      scheduleVideoFinalization();
    };
    recorder.onerror = () => {
      cancelVideoResources();
      dispatch({ type: "fail", reason: "recording_failed" });
    };

    try {
      // No timeslice: one finalized container is more reliable on mobile Safari.
      recorder.start();
    } catch (error) {
      cancelVideoResources();
      dispatch({ type: "fail", reason: cameraVideoError(error) });
      return;
    }

    dispatch({ type: "video_record" });
    active.elapsedTimer = setInterval(() => {
      const seconds = Math.min(MAX_CAMERA_VIDEO_SECONDS, (performance.now() - active.startedAt) / 1_000);
      dispatch({ type: "video_tick", seconds });
    }, 200);
    active.maximumTimer = setTimeout(stopVideoRecording, MAX_CAMERA_VIDEO_SECONDS * 1_000);
  }, [cancelVideoResources, scheduleVideoFinalization, stopVideoRecording]);

  const closeCamera = useCallback(() => {
    dispatch({ type: "close" });
    stopStream();
    clearMedia();
    const historyDepth = historyDepthRef.current;
    if (historyDepth > 0 && window.history.state?.[CAMERA_HISTORY_KEY]) {
      window.history.go(-historyDepth);
      return;
    }
    onClose();
  }, [clearMedia, onClose, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.history.pushState({ ...window.history.state, [CAMERA_HISTORY_KEY]: true }, "");
    historyDepthRef.current = 1;

    const handlePopState = (event: PopStateEvent) => {
      if (stageRef.current === "review" && event.state?.[CAMERA_HISTORY_KEY]) {
        historyDepthRef.current = Math.max(1, historyDepthRef.current - 1);
        restartCamera();
        return;
      }
      stopStream();
      clearMedia();
      onClose();
    };
    const handlePageHide = () => stopStream();
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("pagehide", handlePageHide);
    closeRef.current?.focus();
    void startCamera("environment");

    return () => {
      mountedRef.current = false;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("pagehide", handlePageHide);
      stopStream();
      clearMedia();
      if (window.history.state?.[CAMERA_HISTORY_KEY]) {
        const nextState = { ...window.history.state };
        delete nextState[CAMERA_HISTORY_KEY];
        delete nextState[REVIEW_HISTORY_KEY];
        window.history.replaceState(nextState, "");
      }
    };
  }, [clearMedia, onClose, restartCamera, startCamera, stopStream]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEffectCapabilities(detectEffectCapabilities()));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Keep the ref the async recorder reads in step with rendered state.
  useEffect(() => {
    captureModeRef.current = state.captureMode;
  }, [state.captureMode]);

  /** One tray at a time: opening a tray closes whichever was open. */
  const toggleTray = useCallback((tray: CameraTrayId) => {
    setOpenTray((current) => (current === tray ? null : tray));
  }, []);

  const selectCaptureMode = useCallback((mode: CameraCaptureMode) => {
    // Trays close on a mode change so the new shutter affordance is visible
    // rather than hidden behind an effects panel.
    setOpenTray(null);
    dispatch({ type: "capture_mode", mode });
  }, []);

  useEffect(() => {
    const canvas = effectCanvasRef.current;
    if (!canvas || !live) return;
    let frame = 0;
    let lastDraw = 0;
    const activeDefinition = activeLiveEffect ? MAD_EFFECTS.find((effect) => effect.id === activeLiveEffect.effectId) : null;
    const animated = Boolean(activeDefinition?.animated && !effectCapabilities?.reducedMotion);
    const draw = (time: number) => {
      if (!canvas.isConnected) return;
      if (time - lastDraw >= 80 || !animated) {
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const context = canvas.getContext("2d");
        if (context) {
          context.clearRect(0, 0, width, height);
          if (activeLiveEffect) {
            renderImageEffects(context, [activeLiveEffect], width, height, {
              timeMs: time,
              reducedMotion: effectCapabilities?.reducedMotion ?? true
            });
          }
        }
        lastDraw = time;
      }
      if (animated) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [activeLiveEffect, effectCapabilities?.reducedMotion, live]);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || state.status !== "ready") return;
    dispatch({ type: "capture" });
    try {
      const media = await captureVideoFrame(video, state.facingMode);
      setCapturedEffect(activeLiveEffect);
      stopStream();
      enterReview(media);
      if (activeLiveEffect) dispatch({ type: "edit_image" });
    } catch {
      dispatch({ type: "fail", reason: "capture_failed" });
    }
  }

  async function chooseLibraryPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const media = await localMediaFromLibrary(file);
      setCapturedEffect(null);
      stopStream();
      enterReview(media);
    } catch {
      dispatch({ type: "fail", reason: "library_failed" });
    }
  }

  async function flipCamera() {
    if (!state.canFlip || state.status !== "ready") return;
    // Synchronous guard, not just the status check above: `state` only
    // updates on re-render, so two taps in the same frame would both pass
    // and start overlapping getUserMedia requests -- which is how a flip
    // ends up leaving an orphaned track running.
    if (flipInFlightRef.current) return;
    flipInFlightRef.current = true;
    const nextMode = state.facingMode === "environment" ? "user" : "environment";
    try {
      await startCamera(nextMode, true);
    } finally {
      flipInFlightRef.current = false;
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !state.torchAvailable || state.status !== "ready") return;
    const enabled = !state.torchEnabled;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
      dispatch({ type: "torch", enabled });
    } catch {
      dispatch({ type: "ready", canFlip: state.canFlip, torchAvailable: false });
    }
  }

  function handleShutterPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;

    // VIDEO MODE: tap starts, tap stops. No hold, no hidden gesture.
    if (state.captureMode === "video") {
      if (state.status === "recording_video") {
        pointerGestureRef.current = true;
        stopVideoRecording();
        return;
      }
      if (state.status !== "ready") return;
      pointerGestureRef.current = true;
      void startVideoRecording();
      return;
    }

    // PHOTO MODE: the original gesture, preserved. Tap captures a photo, a
    // hold past the threshold rolls into the same video recorder.
    if (state.status !== "ready") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerGestureRef.current = true;
    holdActiveRef.current = true;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      void startVideoRecording();
    }, HOLD_TO_RECORD_MS);
  }

  function handleShutterPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (!pointerGestureRef.current) return;
    // Video mode owns its own start/stop on pointer-down; releasing the
    // finger must not stop a recording the user deliberately started.
    if (state.captureMode === "video") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    holdActiveRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (holdTimerRef.current !== null) {
      clearHoldTimer();
      void takePhoto();
      return;
    }
    if (state.status === "recording_video") stopVideoRecording();
  }

  function handleShutterPointerCancel() {
    holdActiveRef.current = false;
    pointerGestureRef.current = false;
    if (holdTimerRef.current !== null) {
      clearHoldTimer();
      return;
    }
    if (state.status === "recording_video") stopVideoRecording();
  }

  function handleShutterClick() {
    if (pointerGestureRef.current) {
      pointerGestureRef.current = false;
      return;
    }
    void takePhoto();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCamera();
      return;
    }
    if (event.key !== "Tab" || !rootRef.current) return;
    const focusable = [...rootRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const errorCopy = state.error ? ERROR_COPY[state.error] : null;
  const busy = [
    "requesting_permission",
    "starting",
    "switching_camera",
    "capturing_photo",
    "preparing_video",
    "stopping_video",
    "processing_video"
  ].includes(state.status);
  const recordingVideo = state.status === "recording_video";

  if (state.status === "editing_image" && state.media?.kind === "image") {
    return (
      <ImageEditor
        source={state.media}
        initialEffect={capturedEffect}
        onCancel={() => dispatch({ type: "review", media: state.media! })}
        onDone={(media) => {
          setCapturedEffect(null);
          enterReview(media);
        }}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Camera composer"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[120] flex h-[100svh] h-[100dvh] flex-col overflow-hidden bg-[#080706] text-[#FEFBF3]"
    >
      <header className="relative z-20 flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:px-6">
        <CameraControl ref={closeRef} label="Close camera" onClick={closeCamera}>
          <X className="h-6 w-6" aria-hidden="true" />
        </CameraControl>
        <div className="flex items-center gap-2">
          {live && state.status === "ready" && state.torchAvailable ? (
            <CameraControl
              label={state.torchEnabled ? "Turn torch off" : "Turn torch on"}
              pressed={state.torchEnabled}
              onClick={() => void toggleTorch()}
            >
              {state.torchEnabled ? (
                <ZapOff className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Zap className="h-5 w-5" aria-hidden="true" />
              )}
            </CameraControl>
          ) : null}
          {live && state.status === "ready" && state.canFlip ? (
            <CameraControl label="Flip camera" onClick={() => void flipCamera()} disabled={busy}>
              <SwitchCamera className="h-5 w-5" aria-hidden="true" />
            </CameraControl>
          ) : null}
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview"
          className={cn(
            "h-full w-full object-cover",
            state.facingMode === "user" && "-scale-x-100",
            !live && "invisible"
          )}
        />

        {live ? (
          <canvas
            ref={effectCanvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          />
        ) : null}

        {state.media?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, never uploaded in C1/C2
          <img src={state.media.objectUrl} alt="Photo preview" className="absolute inset-0 h-full w-full object-contain" />
        ) : null}

        {state.media?.kind === "video" ? (
          <video
            ref={reviewVideoRef}
            src={state.media.objectUrl}
            controls
            playsInline
            preload="metadata"
            aria-label="Video preview"
            className={cn(
              "absolute inset-0 h-full w-full object-contain",
              state.media.mirrored && "-scale-x-100"
            )}
          />
        ) : null}

        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-black/45" role="status">
            <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm backdrop-blur-md">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {state.status === "capturing_photo"
                ? "Taking photo"
                : state.status === "preparing_video"
                  ? "Getting microphone ready"
                  : state.status === "stopping_video" || state.status === "processing_video"
                    ? "Finishing video"
                    : "Starting camera"}
            </div>
          </div>
        ) : null}

        {recordingVideo ? (
          <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center" role="status" aria-live="polite">
            {/* "Recording" is stated as TEXT, not carried by the red dot
                alone: colour is not information for someone who cannot see
                it, and a dot beside a timer is ambiguous on its own. */}
            <div className="camera-recording-status">
              <span className="camera-recording-dot" aria-hidden="true" />
              <span className="camera-recording-label">Recording</span>
              {formatRecordingTime(state.recordingSeconds)} / 0:15
            </div>
          </div>
        ) : null}

        {errorCopy ? (
          <div className="absolute inset-0 grid place-items-center bg-[#080706] px-6 text-center" role="alert">
            <div className="max-w-sm">
              <CameraOff className="mx-auto h-10 w-10 text-white/60" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-semibold">{errorCopy.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/65">{errorCopy.description}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {!(["insecure_context", "unsupported", "no_camera"] as CameraFailureReason[]).includes(state.error!) ? (
                  <button type="button" className="camera-secondary-action" onClick={() => void startCamera(state.facingMode)}>
                    Try again
                  </button>
                ) : null}
                <button type="button" className="camera-primary-action" onClick={() => libraryRef.current?.click()}>
                  Choose from library
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {state.status === "completed" ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-5 pb-7 pt-16 text-center">
            <Check className="mx-auto h-7 w-7 text-[#E88C2B]" aria-hidden="true" />
            <p className="mt-2 font-semibold">
              {state.media?.kind === "video" ? "Video ready for editing" : "Photo ready for editing"}
            </p>
            <p className="mt-1 text-sm text-white/65">Your media is still only on this device.</p>
          </div>
        ) : null}
      </main>

      <footer className="relative z-20 shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4 sm:px-6">
        {state.status === "reviewing" || state.status === "completed" ? (
          <div className="mx-auto flex w-full max-w-lg items-center justify-between gap-3">
            <button
              type="button"
              className="camera-secondary-action"
              onClick={state.media?.source === "library" ? () => libraryRef.current?.click() : returnToCamera}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {state.media?.source === "library" ? "Choose another" : "Retake"}
            </button>
            {state.status === "reviewing" ? (
              <div className="flex items-center gap-2">
                {state.media?.kind === "image" ? (
                  <button type="button" className="camera-secondary-action" onClick={() => dispatch({ type: "edit_image" })}>
                    <Edit3 className="h-4 w-4" aria-hidden="true" />
                    Edit
                  </button>
                ) : null}
                <button type="button" className="camera-primary-action" onClick={() => dispatch({ type: "complete" })}>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Use {state.media?.kind === "video" ? "video" : "photo"}
                </button>
              </div>
            ) : (
              <button type="button" className="camera-primary-action" onClick={closeCamera}>Done</button>
            )}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-lg">
            {/* EFFECTS TRAY. Progressive disclosure: the rail is no longer
                permanently on screen competing with the preview -- it opens
                from the tool rail and closes when another tray opens. */}
            {state.status === "ready" && openTray === "effects" ? (
              <div className="camera-effect-rail" role="group" aria-label="Camera effects">
                <button
                  type="button"
                  className={cn("camera-effect-choice", !activeLiveEffect && "is-active")}
                  aria-pressed={!activeLiveEffect}
                  onClick={() => setActiveLiveEffect(null)}
                >
                  <span className="camera-effect-swatch is-none" aria-hidden="true" />
                  None
                </button>
                {(effectCapabilities
                  ? MAD_EFFECTS.filter((effect) => canRenderEffect(effect, effectCapabilities))
                  : MAD_EFFECTS
                ).map((effect) => (
                  <button
                    key={effect.id}
                    type="button"
                    className={cn("camera-effect-choice", activeLiveEffect?.effectId === effect.id && "is-active")}
                    aria-pressed={activeLiveEffect?.effectId === effect.id}
                    onClick={() => setActiveLiveEffect(effectInstanceFor(effect.id))}
                  >
                    <span className="camera-effect-swatch" style={{ "--camera-effect-accent": effect.presentation.accent } as React.CSSProperties} aria-hidden="true" />
                    {effect.name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-3 items-center">
            <button
              type="button"
              aria-label="Choose photo from library"
              className="focus-ring mx-auto flex min-h-12 min-w-12 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium text-white/80"
              onClick={() => libraryRef.current?.click()}
            >
              <Images className="h-6 w-6" aria-hidden="true" />
              Library
            </button>

            <button
              type="button"
              aria-label={
                state.captureMode === "video"
                  ? recordingVideo
                    ? "Stop recording"
                    : "Start recording video"
                  : "Take photo or hold to record video"
              }
              title={
                state.captureMode === "video"
                  ? "Tap to start and stop recording"
                  : "Tap for photo, hold for video"
              }
              disabled={state.status !== "ready" && state.status !== "preparing_video" && !recordingVideo}
              onPointerDown={handleShutterPointerDown}
              onPointerUp={handleShutterPointerUp}
              onPointerCancel={handleShutterPointerCancel}
              onContextMenu={(event) => event.preventDefault()}
              onClick={handleShutterClick}
              className={cn(
                "camera-shutter group mx-auto disabled:cursor-not-allowed disabled:opacity-45",
                recordingVideo && "is-recording"
              )}
            >
              <span aria-hidden="true" className="camera-shutter-core">
                {recordingVideo ? <Square className="h-5 w-5 fill-current" /> : null}
              </span>
            </button>
            {/* TOOL RAIL entry. One control opens the effects tray rather
                than the tray occupying the screen permanently. */}
            {state.status === "ready" ? (
              <button
                type="button"
                aria-label="Effects"
                aria-expanded={openTray === "effects"}
                aria-pressed={openTray === "effects"}
                className={cn(
                  "camera-tool-button",
                  openTray === "effects" && "is-active"
                )}
                onClick={() => toggleTray("effects")}
              >
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Effects</span>
              </button>
            ) : null}
            </div>
            <p className="mt-2 text-center text-xs font-medium text-white/55">
              {recordingVideo
                ? state.captureMode === "video"
                  ? "Tap to finish"
                  : "Release to finish"
                : state.captureMode === "video"
                  ? "Tap to start recording"
                  : "Tap for photo or hold for video"}
            </p>

            {/* MODE STRIP. Two affordances over ONE recorder: photo keeps the
                original tap/hold gesture, video makes the same recording
                explicit. Hidden while recording, because switching mid-clip
                is refused by the reducer anyway and a dead control is worse
                than no control. */}
            {state.status === "ready" || state.status === "capturing_photo" ? (
              <div
                className="camera-mode-strip"
                role="radiogroup"
                aria-label="Capture mode"
              >
                {(["photo", "video"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={state.captureMode === mode}
                    className={cn(
                      "camera-mode-choice",
                      state.captureMode === mode && "is-active"
                    )}
                    onClick={() => selectCaptureMode(mode)}
                  >
                    {mode === "photo" ? "Photo" : "Video"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </footer>

      <input
        ref={libraryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose photo from library"
        onChange={(event) => {
          void chooseLibraryPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function formatRecordingTime(seconds: number): string {
  return `0:${Math.max(0, Math.floor(seconds)).toString().padStart(2, "0")}`;
}

const CameraControl = forwardRef(function CameraControl(
  {
    label,
    pressed,
    children,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    label: string;
    pressed?: boolean;
    children: ReactNode;
  },
  ref: ForwardedRef<HTMLButtonElement>
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className="focus-ring grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-white/15 disabled:opacity-40 motion-reduce:transition-none"
      {...props}
    >
      {children}
    </button>
  );
});
