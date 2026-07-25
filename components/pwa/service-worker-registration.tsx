"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function ServiceWorkerRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadForUpdate = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    const onControllerChange = () => {
      if (!reloadForUpdate.current) return;
      reloadForUpdate.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    let disposed = false;

    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (disposed) return;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(installing);
            }
          });
        });
        void registration.update().catch(() => {});
      })
      .catch(() => {});

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <aside
      className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-[97] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-xl md:bottom-5"
      aria-live="polite"
    >
      <p className="text-sm font-medium">A new version of Mad Buddy is available.</p>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        onClick={() => {
          reloadForUpdate.current = true;
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Update
      </Button>
    </aside>
  );
}
