"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared renderer for private, signed-URL media (Moments, Drops, and any other
 * `media` bucket image). Moment/Drop media lives in a private bucket and is
 * served via short-lived signed URLs, so an image can legitimately fail if its
 * URL expired between server render and display.
 *
 * Behaviour (spec: no browser broken-image icon):
 *  - On the first load error, calls `onRetry` once — the caller regenerates a
 *    fresh signed URL and passes it back as a new `src`.
 *  - A changed `src` resets the retry/fail state so the fresh URL gets a clean
 *    attempt (and could itself retry once).
 *  - If retry doesn't help (or none is provided), falls back to a restrained
 *    "unavailable" card rather than the browser's broken-image glyph.
 */
export function MomentImage({
  src,
  alt,
  onRetry,
  unavailableLabel = "Image unavailable",
  className,
  fallbackClassName
}: {
  src: string | null;
  alt: string;
  /** Called once on first error to regenerate the signed URL (optional). */
  onRetry?: () => void;
  unavailableLabel?: string;
  className?: string;
  fallbackClassName?: string;
}) {
  // Derived reset: when the src prop changes (e.g. a regenerated signed URL),
  // clear the retry/fail flags so the new URL gets a fresh attempt. This is the
  // React-sanctioned "adjust state when a prop changes" pattern.
  const [trackedSrc, setTrackedSrc] = useState(src);
  const [retried, setRetried] = useState(false);
  const [failed, setFailed] = useState(false);
  if (trackedSrc !== src) {
    setTrackedSrc(src);
    setRetried(false);
    setFailed(false);
  }

  if (!src || failed) {
    return (
      <div
        className={cn(
          "grid min-h-56 place-items-center bg-secondary/35 px-6 text-center",
          fallbackClassName ?? className
        )}
      >
        <div>
          <ImageOff className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium">{unavailableLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">This photo could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- private media, short-lived signed URL
    <img
      key={src}
      src={src}
      alt={alt}
      className={cn(
        "block max-h-[560px] min-h-[220px] w-full bg-secondary/40 object-cover object-center",
        className
      )}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        // The signed URL may simply have expired — retry once before giving up.
        if (!retried && onRetry) {
          setRetried(true);
          onRetry();
          return;
        }
        setFailed(true);
      }}
    />
  );
}
