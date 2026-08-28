"use client";

import { useCallback, useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The QR screens -- reference panels "HOST: QR CHECK-IN" and "HOST: ROOM QR".
 *
 * THIS IS NOT A PICTURE OF A QR CODE. The string encoded here is minted by the
 * server (createEventCheckInQrAction / createRoomJoinQrAction) and is:
 *   - HMAC-signed, so a client cannot forge one,
 *   - purpose-bound, so a check-in code cannot be replayed as a room join,
 *   - context-bound, so a code for one Room does not open another,
 *   - expiring, which is what makes a photographed code stop working.
 *
 * The countdown is honest: when it reaches zero the code really is dead
 * server-side, and Refresh mints a NEW token rather than extending the old one.
 *
 * The token never contains user data or secrets. It carries a context id, a
 * purpose, an expiry and a nonce -- nothing that is worth reading.
 */

function secondsLabel(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function QrPanel({
  title,
  subtitle,
  caption,
  mint,
  onClose
}: {
  title: string;
  subtitle: string;
  /** Line under the code, e.g. the Event or Room name. */
  caption: string | null;
  /** Server action that mints a fresh signed token. */
  mint: () => Promise<{ ok: boolean; message: string; token?: string; expiresAtMs?: number }>;
  onClose?: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await mint();
      if (!result.ok || !result.token || !result.expiresAtMs) {
        setError(result.message || "Couldn't create the code.");
        setDataUrl(null);
        setToken(null);
        return;
      }
      // Rendered client-side from the server's string. The image is a picture
      // OF the token; the token is the thing that carries authority.
      const url = await toDataURL(result.token, { margin: 1, width: 260 });
      setDataUrl(url);
      setToken(result.token);
      setExpiresAtMs(result.expiresAtMs);
    } catch {
      setError("Couldn't create the code.");
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    /* Queued rather than called synchronously: refresh() sets loading/error
       state, and doing that in the effect body cascades a render before the
       mint has even started. The microtask defers it past commit. */
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // One-second tick so the countdown matches the server's real expiry.
  useEffect(() => {
    if (expiresAtMs === null) return;
    const update = () => setRemainingMs(expiresAtMs - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAtMs]);

  const expired = expiresAtMs !== null && remainingMs <= 0;

  return (
    <div className="space-y-4 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {/* The code sits on a permanent white plate regardless of theme: a QR
          scanner needs light modules on a dark background, and a dark-theme
          card behind a dark code is unscannable. */}
      <div className="mx-auto flex h-[280px] w-[280px] items-center justify-center rounded-2xl bg-white p-4">
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-neutral-400" aria-hidden="true" />
        ) : error ? (
          <p role="alert" className="px-4 text-sm text-neutral-600">
            {error}
          </p>
        ) : dataUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={dataUrl}
            alt={caption ? `QR code for ${caption}` : "QR code"}
            className={expired ? "h-full w-full opacity-25" : "h-full w-full"}
          />
        ) : null}
      </div>

      {caption ? <p className="text-sm font-semibold">{caption}</p> : null}

      <p role="status" className="text-sm text-muted-foreground">
        {expired ? "Code expired" : expiresAtMs ? `Code expires in ${secondsLabel(remainingMs)}` : " "}
      </p>

      <div className="space-y-2">
        <Button
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          className="min-h-[2.75rem] w-full text-primary"
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>

        {/* TEXT FALLBACK (§37). Someone whose camera will not focus, or who is
            reading this to a person over a phone, still needs a way through.
            The token is safe to show: it grants only what it was minted for and
            it expires. */}
        {token && !expired ? (
          <details className="text-left">
            <summary className="cursor-pointer text-center text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg py-2">
              Can&apos;t scan? Show the code as text
            </summary>
            <p className="mt-2 break-all rounded-xl bg-secondary/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {token}
            </p>
          </details>
        ) : null}

        {onClose ? (
          <Button variant="secondary" onClick={onClose} className="min-h-[2.75rem] w-full">
            Done
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "You joined <Room>" -- reference panel "ATTENDEE: JOINED ROOM".
 *
 * Says what actually happened and what it unlocked, then offers the two real
 * next steps. Never a silent mutation that drops the user somewhere unexplained.
 */
export function JoinedRoomSuccess({
  roomName,
  onOpenRoom,
  onDismiss
}: {
  roomName: string;
  onOpenRoom: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="space-y-1">
        <h2 className="text-xl font-bold leading-tight">
          You joined
          <br />
          {roomName} 🎉
        </h2>
      </div>

      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8 text-primary"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <ul className="mx-auto space-y-2 text-left text-sm text-muted-foreground">
        {["Chat with other members", "See notices", "Stay updated"].map((line) => (
          <li key={line} className="flex items-center gap-2">
            <span className="text-primary" aria-hidden="true">
              +
            </span>
            {line}
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <Button onClick={onOpenRoom} className="min-h-[2.75rem] w-full">
          Open Room
        </Button>
        <Button variant="ghost" onClick={onDismiss} className="min-h-[2.75rem] w-full">
          Maybe later
        </Button>
      </div>
    </div>
  );
}
