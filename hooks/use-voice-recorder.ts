"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  IDLE_VOICE_RECORDER_STATE,
  SERVER_VOICE_RECORDING_CAPABILITY,
  VoiceRecorderController,
  type VoiceRecorderConfig
} from "@/lib/messaging/voice-recording";

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

  return {
    state,
    capability,
    start: () => controller.start(),
    stop: () => controller.stop(),
    cancel: () => controller.cancel(),
    rerecord: () => controller.rerecord()
  };
}
