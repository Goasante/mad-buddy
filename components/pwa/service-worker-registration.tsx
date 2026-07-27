"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PWA_UPDATE_ATTEMPT_KEY,
  normalizeBuildId,
  parseUpdateAttempt,
  serializeUpdateAttempt,
  serviceWorkerUrlForBuild,
  shouldOfferBuildUpdate,
  shouldReloadForControllerChange
} from "@/lib/pwa/update";
import { fetchWithTimeout, withTimeout } from "@/lib/network/resilience";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CONTROLLER_CHANGE_FALLBACK_MS = 4_000;
const UPDATE_CHANNEL = "mad-buddy:pwa-updates";

type UpdateMessage = {
  type?: string;
  buildId?: string;
};

function workerTargetsBuild(worker: ServiceWorker, buildId: string) {
  try {
    return new URL(worker.scriptURL).searchParams.get("build") === buildId;
  } catch {
    return false;
  }
}

export function ServiceWorkerRegistration({
  currentBuildId
}: {
  currentBuildId: string;
}) {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [latestBuildId, setLatestBuildId] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadRequested = useRef(false);
  const reloadTriggered = useRef(false);
  const fallbackTimer = useRef<number | null>(null);

  const previousAttempt =
    typeof window === "undefined"
      ? null
      : parseUpdateAttempt(
          window.sessionStorage.getItem(PWA_UPDATE_ATTEMPT_KEY)
        );
  const versionUpdateAvailable = shouldOfferBuildUpdate({
    currentBuildId,
    latestBuildId,
    previousAttempt
  });
  const updateAvailable = Boolean(waitingWorker) || versionUpdateAvailable;

  const reloadOnce = useCallback(() => {
    if (reloadTriggered.current) return;
    reloadTriggered.current = true;
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost"
    ) {
      return;
    }

    const storedAttempt = parseUpdateAttempt(
      window.sessionStorage.getItem(PWA_UPDATE_ATTEMPT_KEY)
    );
    if (storedAttempt?.buildId === currentBuildId) {
      window.sessionStorage.removeItem(PWA_UPDATE_ATTEMPT_KEY);
    }

    let disposed = false;
    let channel: BroadcastChannel | null = null;
    let updateCheckInFlight: Promise<void> | null = null;

    const publishBuild = (buildId: string) => {
      try {
        channel?.postMessage({ type: "new-build", buildId });
      } catch {
        // Cross-window coordination is optional. Focus and visibility checks
        // remain the compatibility fallback.
      }
    };

    const acceptLatestBuild = (candidate: string | null | undefined) => {
      const buildId = normalizeBuildId(candidate);
      if (!buildId || disposed || buildId === currentBuildId) return;
      setLatestBuildId(buildId);
      publishBuild(buildId);
    };

    const trackInstallingWorker = (
      registration: ServiceWorkerRegistration,
      worker: ServiceWorker | null
    ) => {
      worker?.addEventListener("statechange", () => {
        if (
          !disposed &&
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          const installedWorker = registration.waiting ?? worker;
          if (workerTargetsBuild(installedWorker, currentBuildId)) {
            installedWorker.postMessage({ type: "SKIP_WAITING" });
          } else {
            setWaitingWorker(installedWorker);
          }
        }
      });
    };

    const observeRegistration = (registration: ServiceWorkerRegistration) => {
      registrationRef.current = registration;
      if (registration.waiting && navigator.serviceWorker.controller) {
        if (workerTargetsBuild(registration.waiting, currentBuildId)) {
          // The page already runs this build. Activate its matching worker
          // quietly so a completed app update does not prompt a second time.
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        } else {
          setWaitingWorker(registration.waiting);
        }
      }
      registration.addEventListener("updatefound", () => {
        trackInstallingWorker(registration, registration.installing);
      });
    };

    const checkForUpdate = () => {
      if (disposed || !navigator.onLine) return;
      if (updateCheckInFlight) return updateCheckInFlight;

      updateCheckInFlight = (async () => {
        try {
          const registration = registrationRef.current;
          if (registration) {
            await withTimeout(registration.update(), {
              operation: "check service worker update",
              timeoutMs: 12_000
            });
            if (registration.waiting && navigator.serviceWorker.controller) {
              if (workerTargetsBuild(registration.waiting, currentBuildId)) {
                registration.waiting.postMessage({ type: "SKIP_WAITING" });
              } else {
                setWaitingWorker(registration.waiting);
              }
            }
          }

          const response = await fetchWithTimeout(`/api/version?check=${Date.now()}`, {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" }
          }, 12_000, "check application version");
          if (!response.ok) return;
          const payload = (await response.json()) as { buildId?: string };
          acceptLatestBuild(payload.buildId);
        } catch {
          // Background checks are best effort. A visible error is reserved for
          // a user-initiated update attempt.
        } finally {
          updateCheckInFlight = null;
        }
      })();

      return updateCheckInFlight;
    };

    const onControllerChange = () => {
      if (
        !shouldReloadForControllerChange({
          updateRequested: reloadRequested.current,
          reloadTriggered: reloadTriggered.current
        })
      ) {
        return;
      }
      reloadOnce();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    const onFocus = () => void checkForUpdate();
    const onPageShow = () => void checkForUpdate();

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange
    );
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onFocus);

    try {
      channel = new BroadcastChannel(UPDATE_CHANNEL);
      channel.addEventListener("message", (event) => {
        const message = event.data as UpdateMessage | null;
        if (message?.type === "new-build") {
          const buildId = normalizeBuildId(message.buildId);
          if (buildId && buildId !== currentBuildId) setLatestBuildId(buildId);
        }
      });
    } catch {
      // BroadcastChannel is optional.
    }

    void navigator.serviceWorker
      .register(serviceWorkerUrlForBuild(currentBuildId), {
        updateViaCache: "none"
      })
      .then((registration) => {
        if (disposed) return;
        observeRegistration(registration);
        void checkForUpdate();
      })
      .catch(() => {});

    const interval = window.setInterval(
      () => void checkForUpdate(),
      UPDATE_CHECK_INTERVAL_MS
    );

    return () => {
      disposed = true;
      window.clearInterval(interval);
      if (fallbackTimer.current !== null) {
        window.clearTimeout(fallbackTimer.current);
      }
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange
      );
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onFocus);
      channel?.close();
    };
  }, [currentBuildId, reloadOnce]);

  async function activateUpdate() {
    setUpdateError("");
    const targetBuildId =
      latestBuildId ?? normalizeBuildId(currentBuildId) ?? "current-build";
    window.sessionStorage.setItem(
      PWA_UPDATE_ATTEMPT_KEY,
      serializeUpdateAttempt({
        buildId: targetBuildId,
        attemptedAt: Date.now()
      })
    );
    reloadRequested.current = true;

    try {
      const registration = registrationRef.current;
      if (registration) {
        await withTimeout(registration.update(), {
          operation: "apply service worker update",
          timeoutMs: 12_000
        });
      }
      const worker = registration?.waiting ?? waitingWorker;
      if (worker) {
        worker.postMessage({ type: "SKIP_WAITING" });
        fallbackTimer.current = window.setTimeout(
          reloadOnce,
          CONTROLLER_CHANGE_FALLBACK_MS
        );
        return;
      }

      // The application build can change while sw.js remains byte-identical.
      // A direct, single navigation then fetches the new HTML and hashed Next
      // assets from the network; the worker never serves an app-shell cache.
      reloadOnce();
    } catch {
      reloadRequested.current = false;
      window.sessionStorage.removeItem(PWA_UPDATE_ATTEMPT_KEY);
      setUpdateError(
        navigator.onLine
          ? "The update could not be completed. Try again."
          : "Connect to the internet, then try the update again."
      );
    }
  }

  if (!updateAvailable && !updateError) return null;

  return (
    <aside
      className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-1/2 z-[97] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-xl md:bottom-5"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold">Mad Buddy has been updated</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {updateError || "Restart to get the latest features."}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        onClick={() => void activateUpdate()}
      >
        {updateError ? "Try again" : "Update"}
      </Button>
    </aside>
  );
}
