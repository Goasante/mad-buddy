"use client";

import { Camera, CameraOff, KeyRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { resolveScannedCodeAction } from "@/app/(app)/scan-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/auth/form-field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Shared scanner surface (batch 5 event QR + batch 8 personal QR / short
 * code). Camera frames never leave the device — only the decoded token is
 * sent, and the server re-verifies everything.
 */
export function ScanPageContent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handledRef = useRef(false);
  const [cameraState, setCameraState] = useState<"idle" | "running" | "denied" | "unsupported">("idle");
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitCode = useCallback(
    (code: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      startTransition(async () => {
        try {
          const outcome = await resolveScannedCodeAction(code);
          setResult(outcome);
        } catch {
          setResult({ ok: false, message: "Couldn't check that code. Try again." });
        }
        // Allow another scan after a moment, so one frame doesn't double-fire.
        setTimeout(() => {
          handledRef.current = false;
        }, 1500);
      });
    },
    [startTransition]
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState("idle");
  }, []);

  const startCamera = useCallback(async () => {
    if (!window.BarcodeDetector) {
      setCameraState("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("running");

      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) submitCode(codes[0].rawValue);
        } catch {
          // A failed frame is fine; keep scanning.
        }
        if (streamRef.current) setTimeout(scan, 400);
      };
      void scan();
    } catch {
      setCameraState("denied");
    }
  }, [submitCode]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <div className="mx-auto max-w-[480px] space-y-5 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Scan a code</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan a Muddy&apos;s personal QR to send a request, or an event QR to check in or join its circle.
        </p>
      </header>

      {result ? (
        <div
          role="status"
          className={cn(
            "rounded-[1rem] border p-3 text-sm",
            result.ok
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-800 dark:text-emerald-100"
              : "border-orange-400/20 bg-orange-400/10 text-orange-800 dark:text-orange-50"
          )}
        >
          {result.message}
        </div>
      ) : null}

      <Card className="space-y-4 p-5">
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-black/80">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- silent camera preview */}
          <video ref={videoRef} playsInline muted className={cn("aspect-square w-full object-cover", cameraState !== "running" && "hidden")} />
          {cameraState !== "running" ? (
            <div className="grid aspect-square w-full place-items-center p-6 text-center">
              <div className="space-y-3">
                <CameraOff className="mx-auto h-8 w-8 text-white/60" aria-hidden="true" />
                <p className="text-sm text-white/80">
                  {cameraState === "denied"
                    ? "Camera access was refused. You can still enter the code below."
                    : cameraState === "unsupported"
                      ? "This browser can't scan QR codes. Enter the code below instead."
                      : "The camera stays on this device — only the decoded code is checked."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {cameraState === "running" ? (
          <Button type="button" variant="outline" className="w-full" onClick={stopCamera}>
            <CameraOff className="h-4 w-4" aria-hidden="true" />
            Stop camera
          </Button>
        ) : (
          <Button type="button" className="w-full" onClick={startCamera} disabled={cameraState === "unsupported"}>
            <Camera className="h-4 w-4" aria-hidden="true" />
            Start scanning
          </Button>
        )}
      </Card>

      <Card className="p-5">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualCode.trim()) submitCode(manualCode.trim());
          }}
        >
          <FormField htmlFor="manual-code" label="Enter a code instead">
            <Input
              id="manual-code"
              value={manualCode}
              maxLength={600}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="e.g. 8-character code under a personal QR"
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={!manualCode.trim() || isPending}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Use code
          </Button>
        </form>
      </Card>
    </div>
  );
}
