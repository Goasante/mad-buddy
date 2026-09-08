"use client";

import { CalendarDays } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { refreshEventCoverUrlAction } from "@/app/(app)/event-media-actions";
import { focalObjectPosition } from "@/lib/events/cover";
import { fallbackGradient, resolveEventMedia } from "@/lib/events/event-media";
import { cn } from "@/lib/utils";

/**
 * One initial recovery plus one retry if the freshly-minted URL itself cannot
 * be loaded. A missing object/CDN failure must never turn into an unbounded
 * signed-URL mint loop.
 */
const MAX_COVER_RECOVERY_ATTEMPTS = 2;

/**
 * The one place an Event's artwork is painted.
 *
 * Every Events surface -- hero, discovery card, compact row, detail header --
 * draws its image through this component, so a cover, its focal point and the
 * branded fallback behave identically everywhere. Before this, each surface
 * decided for itself, and a missing cover meant a grey box on one screen and a
 * gradient on another.
 *
 * The fallback is deliberately NOT a neutral placeholder: an Event with no
 * cover still has to look like a Mad Buddy Event, so it gets a deterministic
 * gradient from the brand ramp (see event-media.ts). Deterministic matters --
 * a random pick would flip colour between the server render and hydration.
 *
 * AND NO MONOGRAM (4J §9). It used to centre a giant "MB" in a flat rectangle,
 * which read as an unfinished placeholder -- the exact impression the fallback
 * exists to avoid -- and said nothing about the Event. It now carries a soft
 * Glow bloom and a faint calendar mark, sized to read as texture rather than
 * as a logo waiting for a photo.
 */
export function EventArtwork({
  eventId,
  coverUrl,
  coverExpected = false,
  focalX = 0.5,
  focalY = 0.5,
  alt,
  className,
  /** Scrim strength. Text sits over artwork on the hero and detail header; a
   *  bare thumbnail carries no text and needs no darkening. */
  scrim = "none"
}: {
  eventId: string;
  coverUrl: string | null;
  /**
   * True when the server knows this Event has a canonical cover asset even if
   * its initial signed URL could not be produced. This lets the client recover
   * a transient signing failure without probing every legacy no-cover Event.
   */
  coverExpected?: boolean;
  focalX?: number;
  focalY?: number;
  alt?: string;
  className?: string;
  scrim?: "none" | "soft" | "strong";
}) {
  const [recovery, setRecovery] = useState<{
    eventId: string;
    sourceCoverUrl: string | null;
    url: string | null;
  } | null>(null);

  /*
   * IMPORTANT: renewal promises are component-local, not module-global.
   *
   * A module-level cache keyed only by Event id can survive a client-side
   * account transition long enough for account B to reuse a promise that was
   * authorised for account A. Signed URLs are credentials, so even that narrow
   * race is unacceptable. Local dedupe still prevents duplicate onError/effect
   * requests inside this instance without crossing an auth boundary.
   */
  const inFlightRefreshRef = useRef<Promise<string | null> | null>(null);
  const recoveryAttemptsRef = useRef(new Map<string, number>());

  const renewCover = useCallback((): Promise<string | null> => {
    const existing = inFlightRefreshRef.current;
    if (existing) return existing;

    const request = refreshEventCoverUrlAction(eventId)
      .then((result) => (result.ok ? result.coverUrl : null))
      .catch(() => null)
      .finally(() => {
        if (inFlightRefreshRef.current === request) inFlightRefreshRef.current = null;
      });
    inFlightRefreshRef.current = request;
    return request;
  }, [eventId]);

  const activeCoverUrl =
    recovery?.eventId === eventId && recovery.sourceCoverUrl === coverUrl
      ? recovery.url
      : coverUrl;
  const media = resolveEventMedia(eventId, activeCoverUrl);
  const recoveryScope = `${eventId}:${coverUrl ?? "missing"}`;

  function consumeRecoveryAttempt(): boolean {
    const attempts = recoveryAttemptsRef.current.get(recoveryScope) ?? 0;
    if (attempts >= MAX_COVER_RECOVERY_ATTEMPTS) return false;
    recoveryAttemptsRef.current.set(recoveryScope, attempts + 1);
    return true;
  }

  /*
   * A ranked Event can arrive with `coverUrl === null` for two very different
   * reasons: it genuinely has no cover, or the server knew about the cover but
   * its short-lived credential could not be minted during the initial batch.
   * `coverExpected` preserves that distinction. Only the second case gets an
   * authoritative renewal attempt, so a transient signing failure heals while
   * legacy no-cover Events stay zero-network fallbacks.
   */
  useEffect(() => {
    if (!coverExpected || activeCoverUrl || inFlightRefreshRef.current) return;

    const attempts = recoveryAttemptsRef.current.get(recoveryScope) ?? 0;
    if (attempts >= MAX_COVER_RECOVERY_ATTEMPTS) return;
    recoveryAttemptsRef.current.set(recoveryScope, attempts + 1);

    let cancelled = false;
    void renewCover().then((renewed) => {
      if (cancelled) return;
      if (renewed) {
        setRecovery({ eventId, sourceCoverUrl: coverUrl, url: renewed });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeCoverUrl, coverExpected, coverUrl, eventId, recoveryScope, renewCover]);

  async function recoverBrokenCover() {
    if (inFlightRefreshRef.current || !consumeRecoveryAttempt()) return;

    // Remove the broken credential immediately so the browser never leaves a
    // question-mark/broken-image glyph on screen while renewal is in flight.
    setRecovery({ eventId, sourceCoverUrl: coverUrl, url: null });
    const renewed = await renewCover();
    if (renewed) {
      setRecovery({ eventId, sourceCoverUrl: coverUrl, url: renewed });
    }
  }

  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {media.kind === "image" ? (
        /* Signed, expiring media URLs from private storage: next/image cannot
           fetch them server-side, so the optimizer is not an option here. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.url}
          alt={alt ?? ""}
          className="h-full w-full object-cover"
          style={{ objectPosition: focalObjectPosition(focalX, focalY) }}
          loading="lazy"
          decoding="async"
          onError={() => void recoverBrokenCover()}
        />
      ) : (
        <div
          className="relative h-full w-full"
          style={{ background: fallbackGradient(media.treatment) }}
          aria-hidden="true"
        >
          {/* Off-centre bloom, so the composition has a light source. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 80% at 28% 18%, rgba(255,255,255,0.20), transparent 62%)"
            }}
          />
          {/* A second, tighter warm core keeps the corners from going flat. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(75% 55% at 78% 92%, rgba(255,196,120,0.22), transparent 70%)"
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <CalendarDays className="h-1/4 max-h-16 w-1/4 max-w-16 text-white/25" strokeWidth={1.25} />
          </div>
        </div>
      )}

      {scrim !== "none" ? (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0",
            scrim === "strong"
              ? "bg-gradient-to-t from-black/85 via-black/40 to-black/5"
              : "bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          )}
        />
      ) : null}
    </div>
  );
}
