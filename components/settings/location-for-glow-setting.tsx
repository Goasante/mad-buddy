"use client";

import { ChevronRight, LocateFixed, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type LocationPermissionStatus = "checking" | "enabled" | "needed" | "blocked" | "unavailable";

type LocationForGlowSettingProps = {
  onFeedback: (message: string, error?: boolean) => void;
};

const statusLabels: Record<LocationPermissionStatus, string> = {
  checking: "Checking",
  enabled: "Enabled",
  needed: "Permission needed",
  blocked: "Blocked",
  unavailable: "Unavailable"
};

export function LocationForGlowSetting({ onFeedback }: LocationForGlowSettingProps) {
  const [status, setStatus] = useState<LocationPermissionStatus>("checking");
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let permission: PermissionStatus | null = null;
    let cancelled = false;
    const updateStatus = () => {
      if (cancelled || !permission) return;
      setStatus(
        permission.state === "granted"
          ? "enabled"
          : permission.state === "denied"
            ? "blocked"
            : "needed"
      );
    };

    async function inspectPermission() {
      await Promise.resolve();
      if (cancelled) return;

      if (!("geolocation" in navigator) || !window.isSecureContext) {
        setStatus("unavailable");
        return;
      }

      if (!("permissions" in navigator)) {
        setStatus("needed");
        return;
      }

      try {
        permission = await navigator.permissions.query({ name: "geolocation" });
        if (cancelled) return;
        updateStatus();
        permission.addEventListener("change", updateStatus);
      } catch {
        if (!cancelled) setStatus("needed");
      }
    }

    void inspectPermission();

    return () => {
      cancelled = true;
      permission?.removeEventListener("change", updateStatus);
    };
  }, []);

  function requestLocation() {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setStatus("unavailable");
      setMessage("Location permission requires a supported browser and a secure connection.");
      return;
    }

    setRequesting(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location/update", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            })
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => null)) as { error?: string } | null;
            setMessage(data?.error ?? "Could not enable location for glow. Try again.");
            onFeedback("Couldn’t update this setting. Try again.", true);
            return;
          }

          setStatus("enabled");
          setMessage("Location is enabled. Your exact location remains private.");
          onFeedback("Settings updated");
        } catch {
          setMessage("Could not enable location for glow. Check your connection and try again.");
          onFeedback("Couldn’t update this setting. Try again.", true);
        } finally {
          setRequesting(false);
        }
      },
      (error) => {
        setRequesting(false);
        if (error.code === error.PERMISSION_DENIED) {
          setStatus("blocked");
          setMessage("Location is blocked. Allow it in this browser’s site settings, then check again.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setStatus("unavailable");
          setMessage("This browser could not determine your location. Check device location services.");
        } else {
          setMessage("The location check timed out. Try again.");
        }
        onFeedback("Couldn’t update this setting. Try again.", true);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 15_000
      }
    );
  }

  return (
    <>
      <button
        type="button"
        className="focus-ring safe-motion flex min-h-[4.25rem] w-full items-center justify-between gap-4 px-2 py-3 text-left hover:bg-secondary/40"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        aria-label={`Location for glow, ${statusLabels[status]}`}
      >
        <div className="flex min-w-0 gap-3">
          <LocateFixed
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0",
              status === "enabled" ? "text-blue-500" : "text-muted-foreground"
            )}
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold">Location for glow</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Use your location to create private proximity signals for approved friends.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "hidden rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex",
              status === "enabled"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100"
                : status === "blocked" || status === "unavailable"
                  ? "border-red-400/25 bg-red-400/10 text-red-700 dark:text-red-100"
                  : "border-border text-muted-foreground"
            )}
          >
            {statusLabels[status]}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Location for glow"
        description="Use your location to create private proximity signals for approved friends."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button type="button" onClick={requestLocation} disabled={requesting}>
              {requesting ? "Checking..." : status === "enabled" ? "Update now" : status === "blocked" ? "Check again" : "Continue"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-blue-300/20 bg-blue-300/10 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-200" aria-hidden="true" />
            <p className="text-sm leading-6 text-muted-foreground">
              Your exact location is never shown to friends. Mad Buddy converts it into a general glow signal.
            </p>
          </div>
          <div aria-live="polite">
            <p className="text-sm font-semibold">{statusLabels[status]}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {message || statusMessage(status)}
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

function statusMessage(status: LocationPermissionStatus) {
  if (status === "enabled") {
    return "Location permission is enabled. Mad Buddy can update your glow while visibility is on.";
  }

  if (status === "blocked") {
    return "Allow Location in this browser’s site settings, then return and check again.";
  }

  if (status === "unavailable") {
    return "Location is unavailable in this browser or connection.";
  }

  if (status === "checking") {
    return "Checking this browser’s location permission.";
  }

  return "Continue to review the browser’s location permission request.";
}
