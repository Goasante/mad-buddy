import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  LIVE_WAVEFORM_BAR_COUNT,
  LIVE_WAVEFORM_INTERVAL_MS,
  frameLoudness,
  pushLevel,
  startVoiceAnalyser,
  type VoiceAnalyserRuntime
} from "@/lib/messaging/voice-analyser";

/**
 * The live recording waveform.
 *
 * Fully behavioural: the analyser takes an injectable runtime, so the audio
 * graph, the clock and the frame scheduler are all real objects under test
 * rather than source-text assertions.
 */

function silentFrame(size = 64): Uint8Array {
  // Byte time-domain silence is centred on 128, not 0.
  return new Uint8Array(size).fill(128);
}

function loudFrame(size = 64): Uint8Array {
  const frame = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) frame[index] = index % 2 === 0 ? 255 : 0;
  return frame;
}

function harness(
  overrides: {
    createContextThrows?: boolean;
    noAudioContext?: boolean;
    dataThrows?: boolean;
    suspended?: boolean;
    noResume?: boolean;
    frame?: Uint8Array;
  } = {}
) {
  let time = 0;
  let closes = 0;
  let disconnects = 0;
  let cancels = 0;
  let sourceCount = 0;
  let resumes = 0;
  let contextState = overrides.suspended ? "suspended" : "running";
  let connectedStream: MediaStream | null = null;
  let connectedNode: unknown = null;
  const pending: Array<() => void> = [];

  const analyser = {
    fftSize: 0,
    frequencyBinCount: 64,
    getByteTimeDomainData: (array: Uint8Array) => {
      if (overrides.dataThrows) throw new Error("analyser died");
      array.set(overrides.frame ?? silentFrame(array.length));
    },
    disconnect: () => {
      disconnects += 1;
    }
  };

  const runtime: VoiceAnalyserRuntime = {
    createAudioContext: () => {
      if (overrides.createContextThrows) throw new Error("blocked");
      if (overrides.noAudioContext) return null;
      return {
        createAnalyser: () => analyser,
        createMediaStreamSource: (incoming: MediaStream) => {
          sourceCount += 1;
          connectedStream = incoming;
          return {
          connect: (node: unknown) => {
            connectedNode = node;
          },
          disconnect: () => {
            disconnects += 1;
          }
          };
        },
        close: () => {
          closes += 1;
        },
        get state() {
          return contextState;
        },
        resume: overrides.noResume
          ? undefined
          : () => {
              resumes += 1;
              contextState = "running";
              return Promise.resolve();
            }
      };
    },
    now: () => time,
    requestFrame: (callback) => {
      pending.push(callback);
      return pending.length;
    },
    cancelFrame: () => {
      cancels += 1;
    }
  };

  return {
    runtime,
    advance: (ms: number) => {
      time += ms;
    },
    runFrames: (count: number) => {
      for (let index = 0; index < count; index += 1) {
        const next = pending.shift();
        if (next) next();
      }
    },
    closed: () => closes,
    sourceCount: () => sourceCount,
    resumes: () => resumes,
    connectedStream: () => connectedStream,
    connectedNode: () => connectedNode,
    analyserNode: () => analyser,
    disconnects: () => disconnects,
    cancelled: () => cancels
  };
}

const stream = {} as MediaStream;

// ---------------------------------------------------------------------------
// Level maths
// ---------------------------------------------------------------------------

describe("loudness", () => {
  it("reports silence as zero", () => {
    expect(frameLoudness(silentFrame())).toBe(0);
  });

  it("rises when the microphone actually hears something", () => {
    expect(frameLoudness(loudFrame())).toBeGreaterThan(frameLoudness(silentFrame()));
  });

  it("never exceeds the normalised range", () => {
    expect(frameLoudness(loudFrame())).toBeLessThanOrEqual(1);
    expect(frameLoudness(new Uint8Array(0))).toBe(0);
  });
});

describe("bounded sample series", () => {
  it("never grows past the bar count", () => {
    let levels: number[] = [];
    for (let index = 0; index < LIVE_WAVEFORM_BAR_COUNT * 3; index += 1) {
      levels = pushLevel(levels, 0.5);
    }
    expect(levels).toHaveLength(LIVE_WAVEFORM_BAR_COUNT);
  });

  it("keeps the most recent samples, so the bar scrolls", () => {
    let levels: number[] = [];
    for (let index = 0; index < LIVE_WAVEFORM_BAR_COUNT; index += 1) levels = pushLevel(levels, 0);
    levels = pushLevel(levels, 1);
    expect(levels[levels.length - 1]).toBe(1);
    expect(levels).toHaveLength(LIVE_WAVEFORM_BAR_COUNT);
  });

  it("clamps out-of-range values", () => {
    expect(pushLevel([], 5)[0]).toBe(1);
    expect(pushLevel([], -3)[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("analyser lifecycle", () => {
  it("runs while recording and reports levels", () => {
    const test = harness({ frame: loudFrame() });
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });

    expect(analyser.active).toBe(true);
    test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
    test.runFrames(1);
    expect(onLevels).toHaveBeenCalled();
    analyser.stop();
  });

  it("samples on a cadence rather than every frame", () => {
    const test = harness();
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });

    test.runFrames(3);
    expect(onLevels).not.toHaveBeenCalled();

    test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
    test.runFrames(1);
    expect(onLevels).toHaveBeenCalledTimes(1);
    analyser.stop();
  });

  it("tears the audio graph down on stop", () => {
    const test = harness();
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });
    analyser.stop();

    expect(test.cancelled()).toBeGreaterThan(0);
    expect(test.disconnects()).toBeGreaterThan(0);
    expect(test.closed()).toBe(1);
    expect(analyser.active).toBe(false);
  });

  it("is safe to stop repeatedly", () => {
    const test = harness();
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });
    expect(() => {
      analyser.stop();
      analyser.stop();
      analyser.stop();
    }).not.toThrow();
    expect(test.closed()).toBe(1);
  });

  it("stops sampling once stopped", () => {
    const test = harness();
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });
    analyser.stop();

    test.advance(LIVE_WAVEFORM_INTERVAL_MS * 5);
    test.runFrames(3);
    expect(onLevels).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Failure isolation -- the analyser must never break recording
// ---------------------------------------------------------------------------

describe("analyser failure is never fatal", () => {
  it("degrades quietly when AudioContext does not exist", () => {
    const test = harness({ noAudioContext: true });
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });
    expect(analyser.active).toBe(false);
    expect(() => analyser.stop()).not.toThrow();
  });

  it("degrades quietly when AudioContext construction throws", () => {
    const test = harness({ createContextThrows: true });
    expect(() => startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime })).not.toThrow();
  });

  it("shuts itself down if the analyser dies mid-recording", () => {
    const test = harness({ dataThrows: true });
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });

    test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
    expect(() => test.runFrames(1)).not.toThrow();
    expect(onLevels).not.toHaveBeenCalled();
    expect(analyser.active).toBe(false);
    // And it cleaned up rather than leaking the context.
    expect(test.closed()).toBe(1);
  });

  it("never stops the capture stream's tracks", () => {
    // The recorder owns the stream; stopping tracks here would end the
    // recording the user is still making.
    const stopTrack = vi.fn();
    const liveStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const test = harness();
    const analyser = startVoiceAnalyser(liveStream, () => undefined, { runtime: test.runtime });
    analyser.stop();
    expect(stopTrack).not.toHaveBeenCalled();
  });
});

describe("reduced motion", () => {
  it("draws no animated bars and opens no audio context", () => {
    const test = harness();
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, {
      reducedMotion: true,
      runtime: test.runtime
    });

    expect(analyser.active).toBe(false);
    test.advance(LIVE_WAVEFORM_INTERVAL_MS * 4);
    test.runFrames(3);
    expect(onLevels).not.toHaveBeenCalled();
    expect(test.closed()).toBe(0);
    expect(() => analyser.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: the waveform must survive the elapsed-time tick
// ---------------------------------------------------------------------------

describe("the analyser survives a whole recording", () => {
  /**
   * THE BUG: the recorder's elapsed-time tick calls setState once a second
   * with a fresh state object. The hook derived `captureStream` straight
   * from that state, so React saw a NEW dependency every second, the
   * waveform effect's cleanup ran, and the AudioContext was closed and
   * rebuilt on every tick. The analyser never lived long enough to sample,
   * so the bars looked frozen however loudly you spoke.
   */
  it("keeps one stream identity for the whole recording", () => {
    const hook = readFileSync(
      join(process.cwd(), "hooks/use-voice-recorder.ts"),
      "utf8"
    );
    // Memoised on the KIND, never on the whole state object.
    expect(hook).toContain('const isRecording = state.kind === "recording"');
    expect(hook).toContain("[controller, isRecording]");
    // The old, churning form must not come back.
    expect(hook).not.toContain('captureStream: state.kind === "recording" ? controller.captureStream : null');
  });

  it("does not restart the audio graph while levels keep arriving", () => {
    const test = harness({ frame: loudFrame() });
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });

    // Several sampling windows, as a real recording would produce.
    for (let tick = 0; tick < 5; tick += 1) {
      test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
      test.runFrames(1);
    }

    expect(onLevels.mock.calls.length).toBeGreaterThanOrEqual(5);
    // One graph for the whole session: nothing was torn down mid-recording.
    expect(test.closed()).toBe(0);
    expect(analyser.active).toBe(true);
    analyser.stop();
    expect(test.closed()).toBe(1);
  });

  it("hands React a NEW array each tick so a rerender happens", () => {
    const test = harness({ frame: loudFrame() });
    const snapshots: number[][] = [];
    const analyser = startVoiceAnalyser(stream, (levels) => snapshots.push(levels), {
      runtime: test.runtime
    });

    for (let tick = 0; tick < 3; tick += 1) {
      test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
      test.runFrames(1);
    }
    analyser.stop();

    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    // Same reference twice would mean React skips the render entirely.
    expect(snapshots[0]).not.toBe(snapshots[1]);
    expect(snapshots[1]).not.toBe(snapshots[2]);
  });

  it("grows a rolling history rather than repeating one value", () => {
    const test = harness({ frame: loudFrame() });
    const snapshots: number[][] = [];
    const analyser = startVoiceAnalyser(stream, (levels) => snapshots.push([...levels]), {
      runtime: test.runtime
    });

    for (let tick = 0; tick < 4; tick += 1) {
      test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
      test.runFrames(1);
    }
    analyser.stop();

    // Each tick appends one sample: 1, 2, 3, 4 -- a moving shape, not a
    // single level painted across every bar.
    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[3]).toHaveLength(4);
  });

  it("separates silence from speech from louder speech", () => {
    // The visual transfer function must actually distinguish them.
    const quiet = frameLoudness(silentFrame());
    const speech = frameLoudness(toneFrame(0.1));
    const louder = frameLoudness(toneFrame(0.4));
    expect(quiet).toBe(0);
    expect(speech).toBeGreaterThan(quiet);
    expect(louder).toBeGreaterThan(speech);
    // And speech must be visible, not a rounding error near the floor.
    expect(speech).toBeGreaterThan(0.1);
  });

  it("centres byte data on 128, not on zero", () => {
    // Treating byte 128 as full amplitude would make silence look loud.
    const silence = new Uint8Array(64).fill(128);
    expect(frameLoudness(silence)).toBe(0);
    const offsetOnly = new Uint8Array(64).fill(200);
    expect(frameLoudness(offsetOnly)).toBeGreaterThan(0);
  });
});

/** A sine frame at the given amplitude (0..1) around the 128 midpoint. */
function toneFrame(amplitude: number, size = 64): Uint8Array {
  const frame = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    frame[index] = 128 + Math.round(Math.sin(index / 3) * amplitude * 127);
  }
  return frame;
}

// ---------------------------------------------------------------------------
// SAME STREAM: the analyser must observe the recorder's own capture
// ---------------------------------------------------------------------------

describe("the analyser observes the recorder's stream", () => {
  it("connects the exact stream it was handed", () => {
    const test = harness();
    const recorderStream = { id: "recorder-owned" } as unknown as MediaStream;
    const analyser = startVoiceAnalyser(recorderStream, () => undefined, {
      runtime: test.runtime
    });

    // Identity, not shape: a second getUserMedia() would produce an equal-
    // looking but different stream, and the bars would then be reading a
    // microphone the recorder is not recording.
    expect(test.connectedStream()).toBe(recorderStream);
    analyser.stop();
  });

  it("opens exactly one capture source per recording session", () => {
    const test = harness({ frame: loudFrame() });
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });

    for (let tick = 0; tick < 6; tick += 1) {
      test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
      test.runFrames(1);
    }
    analyser.stop();

    expect(test.sourceCount()).toBe(1);
  });

  it("wires the source into the analyser node that is sampled", () => {
    // M3 regression: skipping the connect leaves a live-looking analyser
    // reading an unconnected node -- silent bars with no error anywhere.
    const test = harness();
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });

    expect(test.connectedNode()).toBe(test.analyserNode());
    analyser.stop();
  });

  it("reports levels only once the graph is actually connected", () => {
    const test = harness({ frame: loudFrame() });
    const onLevels = vi.fn();
    const analyser = startVoiceAnalyser(stream, onLevels, { runtime: test.runtime });

    expect(test.connectedStream()).toBe(stream);
    test.advance(LIVE_WAVEFORM_INTERVAL_MS + 1);
    test.runFrames(1);

    const [levels] = onLevels.mock.calls[0] as [number[]];
    expect(levels[levels.length - 1]).toBeGreaterThan(0);
    analyser.stop();
  });

  it("never stops the recorder's tracks", () => {
    // Stopping tracks here would end the recording the person is still making.
    let trackStops = 0;
    const live = {
      getTracks: () => [{ stop: () => { trackStops += 1; } }]
    } as unknown as MediaStream;
    const test = harness();
    const analyser = startVoiceAnalyser(live, () => undefined, { runtime: test.runtime });
    analyser.stop();

    expect(trackStops).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SUSPENDED CONTEXT: the silent-bars trap
// ---------------------------------------------------------------------------

describe("a suspended AudioContext", () => {
  it("is resumed, because a suspended context reports pure silence", () => {
    // The failure this prevents is invisible: no error, no console warning,
    // just a waveform that never moves however loudly you speak.
    const test = harness({ suspended: true, frame: loudFrame() });
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });

    expect(test.resumes()).toBe(1);
    analyser.stop();
  });

  it("is left alone when it is already running", () => {
    const test = harness({ frame: loudFrame() });
    const analyser = startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime });

    expect(test.resumes()).toBe(0);
    analyser.stop();
  });

  it("still records when resume is unavailable", () => {
    const test = harness({ suspended: true, noResume: true });
    expect(() =>
      startVoiceAnalyser(stream, () => undefined, { runtime: test.runtime })
    ).not.toThrow();
  });
});
