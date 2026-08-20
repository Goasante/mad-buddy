"use client";

import { CalendarDays } from "lucide-react";
import { focalObjectPosition } from "@/lib/events/cover";
import { fallbackGradient, resolveEventMedia } from "@/lib/events/event-media";
import { cn } from "@/lib/utils";

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
  focalX?: number;
  focalY?: number;
  alt?: string;
  className?: string;
  scrim?: "none" | "soft" | "strong";
}) {
  const media = resolveEventMedia(eventId, coverUrl);

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
