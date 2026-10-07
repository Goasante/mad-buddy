"use client";

import { getAccessToken, supabase } from "../../mobile/src/lib/supabase";

export function subscribeMeetupRealtime(
  meetupIds: string[],
  onChange: () => void
): () => void {
  let disposed = false;
  const channels = [...new Set(meetupIds)].slice(0, 40).map((id) =>
    supabase
      .channel("meetup:" + id, { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => {
        if (!disposed) onChange();
      })
  );

  void getAccessToken().then(async (token) => {
    if (disposed || !token) return;
    await supabase.realtime.setAuth(token);
    if (disposed) return;
    for (const channel of channels) channel.subscribe();
  });

  return () => {
    disposed = true;
    for (const channel of channels) void supabase.removeChannel(channel);
  };
}
