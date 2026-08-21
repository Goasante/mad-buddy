"use client";

import { useEffect } from "react";

export function EventShareRedirect({ eventId }: { eventId: string }) {
  const destination = `/events?event=${encodeURIComponent(eventId)}`;
  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-center">
      <div className="space-y-3">
        <p className="text-lg font-semibold">Opening Event…</p>
        <p className="text-sm text-muted-foreground">Checking your access in Mad Buddy.</p>
        <a href={destination} className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground">
          Open Event
        </a>
      </div>
    </main>
  );
}
