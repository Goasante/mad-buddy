import { generateVoiceWaveform } from "@/lib/messaging/voice-waveform";

export const VOICE_RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4"
] as const;

export type VoiceRecordingMime = (typeof VOICE_RECORDING_MIME_CANDIDATES)[number];

export type VoiceRecorderConfig = {
  enabled: boolean;
  maxDurationSeconds: number;
};

export type VoiceRecordingCapability =
  | { supported: true; mimeType: VoiceRecordingMime }
  | {
      supported: false;
      reason: "insecure_context" | "media_devices_unavailable" | "media_recorder_unavailable" | "mime_unsupported";
    };

export type LocalVoiceRecording = {
  blob: Blob;
  objectUrl: string;
  mimeType: VoiceRecordingMime;
  durationSeconds: number;
  waveform: number[] | null;
};

export type VoiceRecorderErrorCode =
  | "permission_denied"
  | "microphone_unavailable"
  | "microphone_busy"
  | "recording_interrupted"
  | "recording_unsupported";

export type VoiceRecorderState =
  | { kind: "idle" }
  | { kind: "requesting_permission" }
  | { kind: "recording"; elapsedSeconds: number; maxDurationSeconds: number }
  | { kind: "stopping" }
  | { kind: "processing" }
  | { kind: "preview"; recording: LocalVoiceRecording }
  | { kind: "failed"; code: VoiceRecorderErrorCode; message: string };

export const IDLE_VOICE_RECORDER_STATE: VoiceRecorderState = { kind: "idle" };
export const SERVER_VOICE_RECORDING_CAPABILITY: VoiceRecordingCapability = {
  supported: false,
  reason: "media_devices_unavailable"
};

export type MediaRecorderLike = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};

export type VoiceRecordingRuntime = {
  secureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (
    stream: MediaStream,
    options: MediaRecorderOptions
  ) => MediaRecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
  now: () => number;
  setInterval: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  generateWaveform?: (blob: Blob) => Promise<number[] | null>;
};

function browserRuntime(): VoiceRecordingRuntime {
  const Recorder = typeof globalThis.MediaRecorder === "undefined" ? null : globalThis.MediaRecorder;
  const mediaDevices = typeof navigator === "undefined" ? null : navigator.mediaDevices;

  return {
    secureContext: typeof globalThis.isSecureContext === "boolean" ? globalThis.isSecureContext : false,
    getUserMedia: mediaDevices?.getUserMedia
      ? (constraints) => mediaDevices.getUserMedia(constraints)
      : undefined,
    createMediaRecorder: Recorder
      ? (stream, options) => new Recorder(stream, options) as unknown as MediaRecorderLike
      : undefined,
    isTypeSupported: Recorder?.isTypeSupported
      ? (mimeType) => Recorder.isTypeSupported(mimeType)
      : undefined,
    now: () => performance.now(),
    setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
    clearInterval: (handle) => globalThis.clearInterval(handle),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    generateWaveform: (blob) => generateVoiceWaveform(blob)
  };
}

export function detectVoiceRecordingCapability(
  runtime: Pick<VoiceRecordingRuntime, "secureContext" | "getUserMedia" | "createMediaRecorder" | "isTypeSupported"> = browserRuntime()
): VoiceRecordingCapability {
  if (!runtime.secureContext) return { supported: false, reason: "insecure_context" };
  if (!runtime.getUserMedia) return { supported: false, reason: "media_devices_unavailable" };
  if (!runtime.createMediaRecorder || !runtime.isTypeSupported) {
    return { supported: false, reason: "media_recorder_unavailable" };
  }

  const mimeType = VOICE_RECORDING_MIME_CANDIDATES.find((candidate) => runtime.isTypeSupported?.(candidate));
  return mimeType
    ? { supported: true, mimeType }
    : { supported: false, reason: "mime_unsupported" };
}

export function recorderError(error: unknown): Pick<Extract<VoiceRecorderState, { kind: "failed" }>, "code" | "message"> {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { code: "permission_denied", message: "Allow microphone access to record a voice message." };
    case "NotFoundError":
      return { code: "microphone_unavailable", message: "No microphone is available on this device." };
    case "NotReadableError":
    case "AbortError":
      return { code: "microphone_busy", message: "The microphone is busy. Close other audio apps and try again." };
    default:
      return { code: "recording_interrupted", message: "Recording was interrupted. Try again." };
  }
}

type RecorderListener = (state: VoiceRecorderState) => void;

/**
 * Owns one local recording session. It deliberately has no upload or message
 * dependency; later phases may consume its result without changing capture.
 */
export class VoiceRecorderController {
  private state: VoiceRecorderState = IDLE_VOICE_RECORDER_STATE;
  private readonly listeners = new Set<RecorderListener>();
  private readonly runtime: VoiceRecordingRuntime;
  private readonly maxDurationSeconds: number;
  private readonly capability: VoiceRecordingCapability;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private operationId = 0;
  private selectedMime: VoiceRecordingMime | null = null;
  private objectUrl: string | null = null;
  private destroyed = false;

  constructor(config: VoiceRecorderConfig, runtime: VoiceRecordingRuntime = browserRuntime()) {
    this.maxDurationSeconds = Math.max(1, config.maxDurationSeconds);
    this.runtime = runtime;
    this.capability = detectVoiceRecordingCapability(runtime);
  }

  getState(): VoiceRecorderState {
    return this.state;
  }

  getCapability(): VoiceRecordingCapability {
    return this.capability;
  }

  subscribe(listener: RecorderListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.destroyed || ["requesting_permission", "recording", "stopping", "processing"].includes(this.state.kind)) {
      return;
    }

    this.abandon(false);
    const capability = this.getCapability();
    if (!capability.supported) {
      this.setState({
        kind: "failed",
        code: "recording_unsupported",
        message: capability.reason === "insecure_context"
          ? "Voice recording requires a secure connection."
          : "Voice recording is not supported in this browser."
      });
      return;
    }

    const operationId = ++this.operationId;
    this.selectedMime = capability.mimeType;
    this.setState({ kind: "requesting_permission" });

    let stream: MediaStream;
    try {
      stream = await this.runtime.getUserMedia!({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (error) {
      if (operationId !== this.operationId || this.destroyed) return;
      this.fail(error);
      return;
    }

    if (operationId !== this.operationId || this.destroyed) {
      stopStream(stream);
      return;
    }

    this.stream = stream;
    let recorder: MediaRecorderLike;
    try {
      // 32 kbps is a speech-oriented size hint. Browsers may ignore it; a
      // rejected hint is retried without the bitrate rather than blocking use.
      recorder = this.runtime.createMediaRecorder!(stream, {
        mimeType: capability.mimeType,
        audioBitsPerSecond: 32_000
      });
    } catch {
      try {
        recorder = this.runtime.createMediaRecorder!(stream, { mimeType: capability.mimeType });
      } catch (error) {
        this.fail(error);
        return;
      }
    }

    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = () => this.fail({ name: "MediaRecorderError" });
    recorder.onstop = () => void this.finishPreview();

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", this.handleTrackEnded, { once: true });
    }

    try {
      recorder.start(1_000);
    } catch (error) {
      this.fail(error);
      return;
    }

    this.startedAtMs = this.runtime.now();
    this.setState({ kind: "recording", elapsedSeconds: 0, maxDurationSeconds: this.maxDurationSeconds });
    this.elapsedTimer = this.runtime.setInterval(() => this.updateElapsed(), 250);
  }

  stop(): void {
    this.stopRecording();
  }

  cancel(): void {
    if (this.destroyed) return;
    this.operationId += 1;
    this.abandon(true);
  }

  async rerecord(): Promise<void> {
    this.cancel();
    await this.start();
  }

  handleVisibilityChange(hidden: boolean): void {
    if (hidden && this.state.kind === "recording") this.stopRecording();
  }

  handlePageHide(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operationId += 1;
    this.abandon(false);
    this.listeners.clear();
  }

  private readonly handleTrackEnded = () => {
    if (this.state.kind === "recording") this.stopRecording();
  };

  private stopRecording(): void {
    if (this.state.kind !== "recording" || !this.recorder) return;
    this.setState({ kind: "stopping" });
    this.clearElapsedTimer();
    try {
      this.recorder.stop();
    } catch (error) {
      this.fail(error);
      return;
    } finally {
      this.releaseStream();
    }
  }

  private async finishPreview(): Promise<void> {
    if (this.destroyed || this.state.kind === "idle") return;
    this.setState({ kind: "processing" });
    const mimeType = this.selectedMime;
    const durationSeconds = Math.min(
      this.maxDurationSeconds,
      Math.max(0.1, (this.runtime.now() - this.startedAtMs) / 1_000)
    );
    const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || mimeType || "" });
    this.recorder = null;
    this.chunks = [];

    if (!mimeType || blob.size === 0) {
      this.setState({
        kind: "failed",
        code: "recording_interrupted",
        message: "No audio was captured. Try recording again."
      });
      return;
    }

    this.revokePreview();
    this.objectUrl = this.runtime.createObjectURL(blob);
    const waveform = this.runtime.generateWaveform
      ? await this.runtime.generateWaveform(blob).catch(() => null)
      : null;
    if (this.destroyed || this.state.kind !== "processing") return;
    this.setState({
      kind: "preview",
      recording: { blob, objectUrl: this.objectUrl, mimeType, durationSeconds, waveform }
    });
  }

  private updateElapsed(): void {
    if (this.state.kind !== "recording") return;
    const elapsedSeconds = Math.min(this.maxDurationSeconds, (this.runtime.now() - this.startedAtMs) / 1_000);
    this.setState({ kind: "recording", elapsedSeconds, maxDurationSeconds: this.maxDurationSeconds });
    if (elapsedSeconds >= this.maxDurationSeconds) this.stopRecording();
  }

  private fail(error: unknown): void {
    this.clearElapsedTimer();
    this.releaseStream();
    this.recorder = null;
    this.chunks = [];
    const mapped = recorderError(error);
    this.setState({ kind: "failed", ...mapped });
  }

  private abandon(emitIdle: boolean): void {
    this.clearElapsedTimer();
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      try {
        this.recorder.stop();
      } catch {
        // The recorder may already have stopped after an interruption.
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.releaseStream();
    this.revokePreview();
    this.selectedMime = null;
    if (emitIdle) this.setState(IDLE_VOICE_RECORDER_STATE);
  }

  private releaseStream(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) {
      track.removeEventListener("ended", this.handleTrackEnded);
    }
    stopStream(this.stream);
    this.stream = null;
  }

  private revokePreview(): void {
    if (!this.objectUrl) return;
    this.runtime.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private clearElapsedTimer(): void {
    if (this.elapsedTimer === null) return;
    this.runtime.clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }

  private setState(state: VoiceRecorderState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
