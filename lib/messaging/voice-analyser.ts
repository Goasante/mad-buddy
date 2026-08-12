/**
 * Live microphone level analysis for the recording composer.
 *
 * VISUAL ONLY. MediaRecorder remains the authoritative recorder; this taps
 * the same stream purely so the person recording can see that the microphone
 * is hearing them. Nothing here is persisted, uploaded, or used to decide
 * whether a recording is valid.
 *
 * FAILURE IS NEVER FATAL. Every entry point is wrapped: if AudioContext is
 * unavailable, blocked by autoplay policy, or throws mid-session, the
 * analyser goes quiet and recording continues untouched. A decoration must
 * never be able to break the feature it decorates.
 *
 * WHY NOT REUSE voice-waveform.ts: that module decodes a FINISHED blob into
 * the 48-point waveform stored with the message. This is the live case --
 * different input (a MediaStream), different lifetime (only while
 * recording), and it produces nothing that outlives the recording.
 */

/** Bars drawn in the recording bar. Bounded so the array can never grow. */
export const LIVE_WAVEFORM_BAR_COUNT = 32;

/**
 * Sampling cadence. ~15fps rather than every animation frame: the bars are
 * ambient feedback, and a phone recording a voice note should not spend a
 * full 60fps of main-thread work on decoration.
 */
export const LIVE_WAVEFORM_INTERVAL_MS = 66;

/** Smaller FFT than the default: we need loudness, not spectral detail. */
const FFT_SIZE = 256;

export type VoiceAnalyserRuntime = {
  createAudioContext: () => AudioContextLike | null;
  now: () => number;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
};

type AudioContextLike = {
  createAnalyser: () => AnalyserLike;
  createMediaStreamSource: (stream: MediaStream) => {
    connect: (node: AnalyserLike) => void;
    disconnect: () => void;
  };
  close: () => Promise<void> | void;
  state?: string;
  resume?: () => Promise<void> | void;
};

type AnalyserLike = {
  fftSize: number;
  frequencyBinCount: number;
  getByteTimeDomainData: (array: Uint8Array) => void;
  disconnect: () => void;
};

function browserRuntime(): VoiceAnalyserRuntime {
  return {
    createAudioContext: () => {
      // Cast through unknown: the real AudioContext is structurally wider
      // than the minimal shape this module needs, and TypeScript will not
      // narrow one to the other directly.
      const scope = globalThis as unknown as {
        AudioContext?: new () => AudioContextLike;
        webkitAudioContext?: new () => AudioContextLike;
      };
      const Context = scope.AudioContext ?? scope.webkitAudioContext;
      if (!Context) return null;
      try {
        return new Context();
      } catch {
        return null;
      }
    },
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    requestFrame: (callback) =>
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => callback())
        : (setTimeout(callback, LIVE_WAVEFORM_INTERVAL_MS) as unknown as number),
    cancelFrame: (handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    }
  };
}

/**
 * Root-mean-square loudness of one time-domain frame, as 0..1.
 *
 * RMS rather than peak: peak jumps to full height on a single click and makes
 * every bar look identical. RMS tracks how loud the room actually is, so a
 * quiet moment settles and a loud one rises.
 */
export function frameLoudness(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    // Byte time-domain data is centred on 128.
    const centred = (sample - 128) / 128;
    sumSquares += centred * centred;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  // Gentle gain: normal speech sits low on a linear RMS scale and would
  // otherwise render as a nearly flat line.
  return Math.min(1, rms * 2.6);
}

/** Appends a level, keeping the series bounded to the bar count. */
export function pushLevel(levels: number[], level: number): number[] {
  const next = levels.length >= LIVE_WAVEFORM_BAR_COUNT ? levels.slice(1) : levels.slice();
  next.push(Math.min(1, Math.max(0, level)));
  return next;
}

export type VoiceAnalyser = {
  /** True when a live audio graph is actually running. */
  readonly active: boolean;
  /** Idempotent. Safe to call repeatedly and after failure. */
  stop: () => void;
};

/**
 * Starts observing a capture stream and reports bounded levels.
 *
 * Returns an analyser whose `stop()` is idempotent, so the caller can call it
 * from finish, cancel, error and unmount without tracking which fired first.
 *
 * NEVER stops the stream's tracks: the recorder owns that lifecycle, and
 * stopping them here would end the recording the user is still making.
 */
export function startVoiceAnalyser(
  stream: MediaStream,
  onLevels: (levels: number[]) => void,
  options: { reducedMotion?: boolean; runtime?: VoiceAnalyserRuntime } = {}
): VoiceAnalyser {
  const runtime = options.runtime ?? browserRuntime();

  // Reduced motion: no animated bars at all rather than a slower animation.
  // The elapsed timer and the explicit recording state already carry the
  // information, so nothing is lost by staying still.
  if (options.reducedMotion) {
    return { active: false, stop: () => undefined };
  }

  let context: AudioContextLike | null = null;
  let analyser: AnalyserLike | null = null;
  let source: { connect: (node: AnalyserLike) => void; disconnect: () => void } | null = null;
  let frame: number | null = null;
  let stopped = false;
  let levels: number[] = [];
  let lastSample = 0;

  const stop = () => {
    // Idempotent by construction: every branch below tolerates already-null
    // handles, and the flag short-circuits repeat calls.
    if (stopped) return;
    stopped = true;
    if (frame !== null) {
      try {
        runtime.cancelFrame(frame);
      } catch {
        /* nothing to cancel */
      }
      frame = null;
    }
    try {
      source?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      analyser?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      void context?.close();
    } catch {
      /* already closing */
    }
    source = null;
    analyser = null;
    context = null;
  };

  try {
    context = runtime.createAudioContext();
    if (!context) return { active: false, stop };

    analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);

    // A context created outside a user gesture starts SUSPENDED, and a
    // suspended context feeds the analyser pure silence -- flat bars, no
    // error, nothing in the console. Resuming is fire-and-forget: if the
    // policy refuses, the bars stay still and recording is untouched.
    if (context.state === "suspended" && context.resume) {
      try {
        void Promise.resolve(context.resume()).catch(() => undefined);
      } catch {
        /* resume unavailable; bars stay still, recording continues */
      }
    }

    const buffer = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (stopped || !analyser) return;
      const time = runtime.now();
      if (time - lastSample >= LIVE_WAVEFORM_INTERVAL_MS) {
        lastSample = time;
        try {
          analyser.getByteTimeDomainData(buffer);
          levels = pushLevel(levels, frameLoudness(buffer));
          onLevels(levels);
        } catch {
          // A dead analyser stops the visualisation, never the recording.
          stop();
          return;
        }
      }
      frame = runtime.requestFrame(tick);
    };

    frame = runtime.requestFrame(tick);
    return {
      get active() {
        return !stopped;
      },
      stop
    };
  } catch {
    // AudioContext unavailable or blocked. Recording is unaffected.
    stop();
    return { active: false, stop };
  }
}
