"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const NAVIGATION_STALL_MS = 15_000;

function isChunkLoadFailure(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "";
  return /chunkloaderror|loading chunk|failed to fetch dynamically imported module/i.test(message);
}

export function NavigationWatchdog() {
  const pathname = usePathname();
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const targetRef = useRef<string | null>(null);
  const [stalled, setStalled] = useState(false);

  const clearWatch = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    targetRef.current = null;
    setStalled(false);
  }, []);

  const showRecovery = useCallback(() => {
    if (!startedAtRef.current) startedAtRef.current = Date.now();
    const durationMs = Date.now() - startedAtRef.current;
    console.warn("[performance] navigation did not complete", { durationMs });
    setStalled(true);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(clearWatch);
    return () => window.cancelAnimationFrame(frame);
  }, [clearWatch, pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const element = event.target;
      if (!(element instanceof Element)) return;
      const anchor = element.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      if (target.href === window.location.href) return;

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      targetRef.current = target.href;
      startedAtRef.current = Date.now();
      setStalled(false);
      timerRef.current = window.setTimeout(showRecovery, NAVIGATION_STALL_MS);
    };

    const onError = (event: ErrorEvent) => {
      if (!isChunkLoadFailure(event.error ?? event.message)) return;
      targetRef.current = window.location.href;
      startedAtRef.current = Date.now();
      showRecovery();
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkLoadFailure(event.reason)) return;
      targetRef.current = window.location.href;
      startedAtRef.current = Date.now();
      showRecovery();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [showRecovery]);

  if (!stalled) return null;

  return (
    <aside
      className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-[96] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-border bg-card p-4 shadow-xl md:bottom-5"
      role="alert"
    >
      <p className="text-sm font-semibold">This page is taking longer than expected</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Check your connection, then retry the page.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={clearWatch}>
          Stay here
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => window.location.assign(targetRef.current ?? window.location.href)}
        >
          Retry
        </Button>
      </div>
    </aside>
  );
}
