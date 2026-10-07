"use client";

import { useEffect, useRef } from "react";
import { subscribeMeetupRealtime } from "@/lib/platform";

/**
 * Private, payload-minimal Meet Up live invalidation.
 *
 * Realtime transports only a meetup id. Canonical state is always re-read from
 * the server, so no coordinate, route, distance or raw participant row is
 * trusted from the socket.
 */
export function useMeetupRealtime(input: {
  meetupIds: string[];
  enabled: boolean;
  onChange: () => Promise<void> | void;
}) {
  const onChangeRef = useRef(input.onChange);
  onChangeRef.current = input.onChange;
  const key = [...new Set(input.meetupIds)].sort().join(",");

  useEffect(() => {
    if (!input.enabled || !key) return;

    let timer: number | null = null;
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      timer = window.setTimeout(() => {
        queued = false;
        void onChangeRef.current();
      }, 180);
    };

    const unsubscribe = subscribeMeetupRealtime(key.split(",").filter(Boolean), refresh);

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [input.enabled, key]);
}
