import { generateVoiceWaveform } from "@/lib/messaging/voice-waveform";

/**
 * Recording formats, in preference order.
 *
 * webm/opus FIRST.
 *
 * This was briefly reordered to put mp4/aac first, on the theory that some
 * engines record webm but cannot decode it. That inverted the real failure:
 * Chromium reports isTypeSupported("audio/mp4") === true, then produces WebM
 * bytes anyway. The pipeline was told "mp4", the bytes said WebM, and the
 * recording failed byte verification while also refusing to play back.
 *
 * isTypeSupported() answers "will I accept this string", NOT "will I emit
 * this container". Only the recorder's own reported mimeType, read after
 * construction, is authoritative -- which is why selectRecordingMime below
 * verifies rather than trusts, and why the whole pipeline keys off
 * blobMimeType rather than the requested type.
 *
 * Order reflects what Mad Buddy can record, verify, store AND play end to
 * end: webm/opus on Chromium and Firefox, mp4/aac on WebKit, which cannot
 * produce webm at all.
 */
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
  blobMimeType: string;
  durationSeconds: number;
  waveform: number[] | null;
  diagnostics: VoiceCaptureDiagnostics;
  interruption: "backgrounded" | "microphone_ended" | null;
};

export type VoiceCaptureDiagnostics = {
  selectedMimeType: VoiceRecordingMime;
  blobMimeType: string;
  blobBytes: number;
  measuredDurationSeconds: number;
  audioTrackCount: number;
  trackEnabled: boolean;
  trackMuted: boolean;
  trackReadyState: MediaStreamTrackState;
};

export const MIN_VOICE_RECORDING_BYTES = 256;
const FINAL_DATA_GRACE_MS = 50;

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
  onpause?: (() => void) | null;
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
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
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
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
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

/**
 * Whether the recorder will actually EMIT the container it was asked for.
 *
 * isTypeSupported() only reports whether a type string is accepted. Chromium
 * returns true for "audio/mp4" and then emits WebM, so the requested type is
 * a request, never a fact. `MediaRecorder.mimeType`, read after construction,
 * is the browser stating what it is really going to produce.
 *
 * Returns the family both agree on, or null when they disagree -- in which
 * case the caller must believe the recorder, not the request.
 */
export function agreedRecordingFamily(requested: string, reported: string): "webm" | "mp4" | null {
  const family = (value: string): "webm" | "mp4" | null => {
    const base = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (base === "audio/webm" || base.includes("matroska")) return "webm";
    if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac") return "mp4";
    return null;
  };
  const requestedFamily = family(requested);
  const reportedFamily = reported ? family(reported) : requestedFamily;
  // An empty reported type means the engine declined to say; the request
  // stands. A stated disagreement means the request was a fiction.
  return reportedFamily !== null && reportedFamily === requestedFamily ? requestedFamily : null;
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
    case "NotSupportedError":
      return { code: "recording_unsupported", message: "Voice recording is not supported in this browser." };
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

  /**
   * Read-only view of the live capture stream, for VISUAL analysis only.
   *
   * Deliberately a getter rather than a second getUserMedia call: the live
   * waveform must observe the exact stream being recorded, and opening a
   * second microphone capture would double the permission surface, the track
   * count and the battery cost for a decoration.
   *
   * Callers may read from it (an AnalyserNode tap) but must never stop its
   * tracks -- this controller owns the lifecycle and stops them itself.
   */
  get captureStream(): MediaStream | null {
    return this.stream;
  }
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private finalizationTimer: ReturnType<typeof setTimeout> | null = null;
  private operationId = 0;
  private selectedMime: VoiceRecordingMime | null = null;
  private objectUrl: string | null = null;
  private stopEventReceived = false;
  private captureTrack: MediaStreamTrack | null = null;
  private captureTrackSnapshot: Pick<
    VoiceCaptureDiagnostics,
    "audioTrackCount" | "trackEnabled" | "trackMuted" | "trackReadyState"
  > | null = null;
  private destroyed = false;
  private interruption: LocalVoiceRecording["interruption"] = null;

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
    this.interruption = null;
    this.setState({ kind: "requesting_permission" });

    let stream: MediaStream;
    try {
      stream = await this.runtime.getUserMedia!({
        // Keep capture conservative. Individual processing constraints have
        // produced silent tracks on otherwise supported mobile devices.
        audio: true,
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
    const audioTracks = getAudioTracks(stream);
    const captureTrack = audioTracks[0] ?? null;
    if (
      !captureTrack ||
      !captureTrack.enabled ||
      captureTrack.muted ||
      captureTrack.readyState !== "live"
    ) {
      this.fail({ name: "NotFoundError" });
      return;
    }
    this.captureTrack = captureTrack;
    this.captureTrackSnapshot = {
      audioTrackCount: audioTracks.length,
      trackEnabled: captureTrack.enabled,
      trackMuted: captureTrack.muted,
      trackReadyState: captureTrack.readyState
    };
    let recorder: MediaRecorderLike;
    try {
      recorder = this.runtime.createMediaRecorder!(stream, { mimeType: capability.mimeType });
      // isTypeSupported() can lie: Chromium accepts "audio/mp4" and then emits
      // WebM. The recorder's own mimeType is the browser stating what it will
      // really produce, so if the two disagree, re-create it letting the
      // engine pick its native container -- exactly what a plain
      // `new MediaRecorder(stream)` does, and what actually plays back.
      if (agreedRecordingFamily(capability.mimeType, recorder.mimeType ?? "") === null) {
        recorder = this.runtime.createMediaRecorder!(stream, {});
      }
    } catch (error) {
      this.fail(error);
      return;
    }

    this.recorder = recorder;
    this.chunks = [];
    this.stopEventReceived = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
      // Some mobile implementations dispatch the final data event very close
      // to (or just after) stop. Wait for a brief quiet period before assembly.
      if (this.stopEventReceived) this.scheduleFinalization();
    };
    recorder.onerror = () => this.fail({ name: "MediaRecorderError" });
    recorder.onpause = () => {
      if (this.state.kind !== "recording") return;
      this.interruption = "microphone_ended";
      this.stopRecording();
    };
    recorder.onstop = () => {
      this.stopEventReceived = true;
      this.scheduleFinalization();
    };

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", this.handleTrackEnded, { once: true });
    }

    try {
      // A single final Blob is more interoperable than timesliced MP4 chunks,
      // especially on mobile WebKit where container metadata is finalized at stop.
      recorder.start();
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
    if (hidden && this.state.kind === "recording") {
      this.interruption = "backgrounded";
      this.stopRecording();
    }
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
    if (this.state.kind === "recording") {
      this.interruption = "microphone_ended";
      this.stopRecording();
    }
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

  private scheduleFinalization(): void {
    this.clearFinalizationTimer();
    this.finalizationTimer = this.runtime.setTimeout(() => {
      this.finalizationTimer = null;
      this.finishPreview();
    }, FINAL_DATA_GRACE_MS);
  }

  private finishPreview(): void {
    if (this.destroyed || this.state.kind === "idle") return;
    this.setState({ kind: "processing" });
    const mimeType = this.selectedMime;
    const durationSeconds = Math.min(
      this.maxDurationSeconds,
      Math.max(0.1, (this.runtime.now() - this.startedAtMs) / 1_000)
    );
    const blobMimeType = this.recorder?.mimeType || mimeType || "";
    const blob = new Blob(this.chunks, { type: blobMimeType });
    const captureSnapshot = this.captureTrackSnapshot;
    this.recorder = null;
    this.chunks = [];
    this.captureTrack = null;
    this.captureTrackSnapshot = null;

    if (!mimeType || blob.size < MIN_VOICE_RECORDING_BYTES) {
      this.setState({
        kind: "failed",
        code: "recording_interrupted",
        message: "No audio was captured. Try recording again."
      });
      return;
    }

    this.revokePreview();
    this.objectUrl = this.runtime.createObjectURL(blob);
    const objectUrl = this.objectUrl;
    const diagnostics: VoiceCaptureDiagnostics = {
      selectedMimeType: mimeType,
      blobMimeType: blob.type,
      blobBytes: blob.size,
      measuredDurationSeconds: durationSeconds,
      audioTrackCount: captureSnapshot?.audioTrackCount ?? 0,
      trackEnabled: captureSnapshot?.trackEnabled ?? false,
      trackMuted: captureSnapshot?.trackMuted ?? true,
      trackReadyState: captureSnapshot?.trackReadyState ?? "ended"
    };
    this.setState({
      kind: "preview",
      recording: {
        blob,
        objectUrl,
        mimeType,
        blobMimeType: blob.type,
        durationSeconds,
        waveform: null,
        diagnostics,
        interruption: this.interruption
      }
    });

    // Waveform decoding is presentation-only. It must never delay or disable
    // native audio playback, and a decode failure leaves a valid audio preview.
    if (this.runtime.generateWaveform) {
      void this.runtime.generateWaveform(blob).catch(() => null).then((waveform) => {
        if (this.destroyed || this.state.kind !== "preview") return;
        if (this.state.recording.objectUrl !== objectUrl) return;
        this.setState({
          kind: "preview",
          recording: { ...this.state.recording, waveform }
        });
      });
    }
  }

  private updateElapsed(): void {
    if (this.state.kind !== "recording") return;
    const elapsedSeconds = Math.min(this.maxDurationSeconds, (this.runtime.now() - this.startedAtMs) / 1_000);
    this.setState({ kind: "recording", elapsedSeconds, maxDurationSeconds: this.maxDurationSeconds });
    if (elapsedSeconds >= this.maxDurationSeconds) this.stopRecording();
  }

  private fail(error: unknown): void {
    this.clearElapsedTimer();
    this.clearFinalizationTimer();
    this.releaseStream();
    this.recorder = null;
    this.captureTrack = null;
    this.captureTrackSnapshot = null;
    this.chunks = [];
    const mapped = recorderError(error);
    this.setState({ kind: "failed", ...mapped });
  }

  private abandon(emitIdle: boolean): void {
    this.clearElapsedTimer();
    this.clearFinalizationTimer();
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
      this.recorder.onpause = null;
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
    this.interruption = null;
    this.stopEventReceived = false;
    this.captureTrack = null;
    this.captureTrackSnapshot = null;
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

  private clearFinalizationTimer(): void {
    if (this.finalizationTimer === null) return;
    this.runtime.clearTimeout(this.finalizationTimer);
    this.finalizationTimer = null;
  }

  private setState(state: VoiceRecorderState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function getAudioTracks(stream: MediaStream): MediaStreamTrack[] {
  if (typeof stream.getAudioTracks === "function") return stream.getAudioTracks();
  return stream.getTracks().filter((track) => track.kind === "audio");
}
