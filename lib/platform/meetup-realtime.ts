"use client";

import { authenticateRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";

export function subscribeMeetupRealtime(
  meetupIds: string[],
  onChange: () => void
): () => void {
  let client: ReturnType<typeof createSupabaseBrowserClient> | null = null;
  try {
    client = createSupabaseBrowserClient();
  } catch {
    return () => {};
  }

  let disposed = false;
  const channels = [...new Set(meetupIds)].slice(0, 40).map((id) =>
    client!
      .channel("meetup:" + id, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => {
        if (!disposed) onChange();
      })
  );

  void authenticateRealtime(client).then(() => {
    if (disposed) return;
    for (const channel of channels) channel.subscribe();
  });

  return () => {
    disposed = true;
    for (const channel of channels) void client?.removeChannel(channel);
  };
}
