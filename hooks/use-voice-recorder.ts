"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  IDLE_VOICE_RECORDER_STATE,
  SERVER_VOICE_RECORDING_CAPABILITY,
  VoiceRecorderController,
  type VoiceRecorderConfig
} from "@/lib/messaging/voice-recording";
import { reportVoiceFailure } from "@/lib/messaging/voice-reliability";

const subscribeToNothing = () => () => undefined;

export function useVoiceRecorder(conversationId: string, config: VoiceRecorderConfig) {
  const enabled = config.enabled;
  const maxDurationSeconds = config.maxDurationSeconds;
  const controller = useMemo(
    () => {
      // The scope reference intentionally makes a conversation switch destroy
      // the old controller even though no conversation data enters recording.
      void conversationId;
      return new VoiceRecorderController({ enabled, maxDurationSeconds });
    },
    [enabled, maxDurationSeconds, conversationId]
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(() => onStoreChange()),
    [controller]
  );
  const getSnapshot = useCallback(() => controller.getState(), [controller]);
  const getCapability = useCallback(() => controller.getCapability(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot, () => IDLE_VOICE_RECORDER_STATE);
  const isRecording = state.kind === "recording";
  const captureStream = useMemo(
    () => (isRecording ? controller.captureStream : null),
    [controller, isRecording]
  );
  const capability = useSyncExternalStore(
    subscribeToNothing,
    getCapability,
    () => SERVER_VOICE_RECORDING_CAPABILITY
  );

  useEffect(() => {
    const onVisibilityChange = () => controller.handleVisibilityChange(document.hidden);
    const onPageHide = () => controller.handlePageHide();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.getState().kind !== "recording") return;
      event.preventDefault();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      controller.destroy();
    };
  }, [controller]);

  useEffect(() => {
    if (state.kind !== "failed") return;
    reportVoiceFailure(
      state.code === "recording_unsupported"
        ? "recording_unsupported"
        : state.code === "permission_denied"
          ? "permission_denied"
          : "recording_interrupted"
    );
  }, [state]);

  return {
    state,
    capability,
    /**
     * The live capture stream, for the recording waveform only.
     *
     * Read from the controller rather than opened again: a second
     * getUserMedia would mean two microphone captures for one recording.
     * Null unless actively recording, which keeps the analyser from running
     * while idle.
     *
     * MEMOISED ON `state.kind`, NOT ON `state`. The elapsed-time tick calls
     * setState once a second with a fresh object, so reading this straight
     * off `state` handed React a new dependency every second: the waveform's
     * effect tore down and rebuilt the AudioContext on each tick, and the
     * analyser never lived long enough to sample anything. The underlying
     * MediaStream is stable for the whole recording -- only the state
     * wrapper churns -- so the identity must follow the stream, not the
     * timer.
     */
    captureStream,
    start: () => controller.start(),
    stop: () => controller.stop(),
    cancel: () => controller.cancel(),
    rerecord: () => controller.rerecord()
  };
}
