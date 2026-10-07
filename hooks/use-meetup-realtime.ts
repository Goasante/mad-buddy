"use client";

import { useEffect, useRef } from "react";
import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Private, payload-minimal Meet Up live invalidation.
 *
 * The database broadcasts only { meetupId } on participant/meetup changes.
 * No meetup row, beacon coordinate, route, distance, or raw location is sent
 * over Realtime. Each signal simply asks the screen to refetch its canonical
 * server projection. Poll/focus refresh remains the fallback.
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

    let supabase: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      timer = window.setTimeout(() => {
        queued = false;
        if (!disposed) void onChangeRef.current();
      }, 180);
    };

    const channels = key.split(",").filter(Boolean).slice(0, 40).map((id) =>
      supabase!
        .channel(`meetup:${id}`, { config: { private: true } })
        .on("broadcast", { event: "changed" }, refresh)
    );

    void authenticateRealtime(supabase).then(() => {
      if (disposed) return;
      for (const channel of channels) channel.subscribe();
    });

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      for (const channel of channels) void supabase?.removeChannel(channel);
    };
  }, [input.enabled, key]);
}
