"use client";

import { CheckCircle2, LocateFixed, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LocationPermissionPanel() {
  const [status, setStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Weak location signals will never create a strong glow.");

  function requestPermission() {
    setStatus("checking");

    if (!("geolocation" in navigator)) {
      setStatus("error");
      setMessage("This browser does not support location permission.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch("/api/location/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy
            })
          });

          if (!response.ok) {
            const data = (await response.json().catch(() => ({ error: "Could not save private location." }))) as {
              error?: string;
            };
            setStatus("error");
            setMessage(data.error ?? "Could not save private location.");
            return;
          }

          setStatus("ready");
          setMessage("Private proximity signal saved.");
        } catch {
          setStatus("error");
          setMessage("Could not save private location.");
        }
      },
      () => {
        setStatus("error");
        setMessage("Location permission was not granted.");
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 10_000
      }
    );
  }

  return (
    <div className="rounded-lg border border-blue-300/20 bg-blue-300/10 p-5">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-300/15 text-blue-100">
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-semibold">Enable private proximity</h3>
          <p className="mt-2 text-sm leading-6 text-blue-50/80">
            Your exact location is never shown to friends. Mad Buddy converts it into a general glow signal.
            You can turn location access off anytime.
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-md bg-white/[0.06] p-3 text-sm leading-6 text-muted-foreground">
        {message}
      </div>
      {status === "ready" ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-100">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Private location update received.
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={requestPermission} disabled={status === "checking"}>
          {status === "checking" ? "Checking..." : "Enable location"}
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-accent" aria-hidden="true" />
          No maps. No exact distance.
        </div>
      </div>
    </div>
  );
}
