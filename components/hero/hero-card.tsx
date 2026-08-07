"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  heroScrim,
  sampleFootLuminance,
  HERO_SCRIM_DEFAULT,
  type HeroLuminance
} from "@/lib/design/hero";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * The Hero Card — Mad Buddy's cinematic presentation surface.
 *
 * One large image, a progressive blur rising from its foot, and an identity
 * layer reading over it. Profiles use it to introduce a person; Moments use it
 * to present a memory; Air and Spark will use it unchanged.
 *
 * DELIBERATELY CONTENT-AGNOSTIC. It knows about an image, a scrim and three
 * slots — never about Muddies, captions, plans or Moments. Every screen-shaped
 * decision arrives as a prop, which is what stops this becoming a second
 * profile component with a different name.
 *
 * Why a progressive blur instead of a card below the image:
 * a card cuts the picture off at a hard edge and turns a person into a
 * thumbnail with a data sheet attached. The blur keeps the image running to
 * the bottom of the frame with the text sitting *in* it, so the photograph
 * stays the subject and the words are part of the same object.
 */

export type HeroCardProps = {
  /** The image itself, rendered by the caller (MomentImage, next/image, img). */
  media: ReactNode;
  /**
   * Identity layer, inside the blur: name, membership, presence.
   * The name should be the heaviest thing on the screen.
   */
  identity: ReactNode;
  /** The one dominant action. Rendered last, below the identity. */
  action?: ReactNode;
  /** Small controls pinned to the top of the frame (close, overflow). */
  overlay?: ReactNode;
  /**
   * Foot luminance if the caller already knows it. When omitted, the Hero
   * samples the image once on load and adapts itself.
   */
  luminance?: HeroLuminance;
  /** Aspect ratio of the frame. Portrait by default — this system is for people. */
  aspect?: "portrait" | "square" | "tall" | "auto";
  className?: string;
  /** Extra classes for the blur layer, e.g. taller on a caption-heavy Moment. */
  scrimClassName?: string;
};

const ASPECT: Record<NonNullable<HeroCardProps["aspect"]>, string> = {
  portrait: "aspect-[4/5]",
  square: "aspect-square",
  tall: "aspect-[3/4]",
  auto: ""
};

export function HeroCard({
  media,
  identity,
  action,
  overlay,
  luminance,
  aspect = "portrait",
  className,
  scrimClassName
}: HeroCardProps) {
  const reducedMotion = useReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);
  // Sampled luminance, when the caller did not supply one.
  const [sampled, setSampled] = useState<HeroLuminance>(null);
  const [loaded, setLoaded] = useState(false);

  const scrim = heroScrim(luminance ?? sampled);

  /**
   * Read the image's foot brightness once it has painted.
   *
   * Listens on the frame rather than the image, because the image is the
   * caller's element and may be any component. `capture` is required: `load`
   * does not bubble.
   */
  const onLoadCapture = useCallback(() => {
    setLoaded(true);
    if (luminance !== undefined) return;
    const image = frameRef.current?.querySelector("img");
    if (!image) return;
    setSampled(sampleFootLuminance(image));
  }, [luminance]);

  return (
    <div
      ref={frameRef}
      onLoadCapture={onLoadCapture}
      className={cn(
        "relative isolate overflow-hidden rounded-[1.75rem] bg-secondary/40",
        ASPECT[aspect],
        className
      )}
    >
      {/* The image. Fades up rather than snapping in, so a slow signed URL
          resolves gracefully instead of flashing. */}
      <div
        className={cn(
          "absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover",
          !reducedMotion && "transition-opacity duration-500 ease-out",
          loaded ? "opacity-100" : "opacity-0"
        )}
      >
        {media}
      </div>

      {/* WARMTH, not glassmorphism. A low ember wash at the foot of the frame
          is the signature: it ties the photograph to the brand without tinting
          the subject's face, because it only ever touches the bottom third. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(120%_80%_at_50%_100%,rgb(249_115_22/0.28),transparent_70%)] mix-blend-soft-light"
      />

      {/* THE PROGRESSIVE BLUR.
          Three stacked bands rather than one: a single blurred div with a
          gradient mask is the obvious approach and it produces a visible hard
          line at the mask edge on most browsers. Stacking bands of increasing
          blur and opacity, each masked to fade upward, reads as a genuine
          depth ramp — the image stays visible through the top of it. */}
      <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[58%]", scrimClassName)}>
        {[0.35, 0.65, 1].map((step, index) => (
          <div
            key={step}
            className="absolute inset-x-0 bottom-0"
            style={{
              height: `${step * 100}%`,
              backdropFilter: `blur(${Math.round(scrim.blurPx * (index + 1) * 0.45)}px)`,
              WebkitBackdropFilter: `blur(${Math.round(scrim.blurPx * (index + 1) * 0.45)}px)`,
              // Each band fades out upward so no edge is ever a line.
              maskImage: "linear-gradient(to top, black 40%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(to top, black 40%, transparent 100%)"
            }}
          />
        ))}
        {/* The tint that buys contrast back, adapted to the image. */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, rgb(0 0 0 / ${scrim.scrimOpacity}) 0%, rgb(0 0 0 / ${
              scrim.scrimOpacity * 0.55
            }) 45%, transparent 100%)`
          }}
        />
      </div>

      {overlay ? <div className="absolute inset-x-0 top-0 z-20 p-3">{overlay}</div> : null}

      {/* The identity layer. Ordered exactly as the hierarchy requires:
          name, identity, presence, then the single dominant action. */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 p-5 text-white"
        style={scrim.textShadow ? { textShadow: scrim.textShadow } : undefined}
      >
        <div className="min-w-0">{identity}</div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * The name block inside a Hero.
 *
 * Separate from HeroCard so the hierarchy — name heaviest, everything else
 * quieter — is expressed once and cannot drift between Profile and Moments.
 */
export function HeroIdentity({
  title,
  badge,
  meta,
  note
}: {
  title: ReactNode;
  /** Membership or verification. Sits WITH the name, never above it. */
  badge?: ReactNode;
  /** Presence, location, time — the quiet supporting line. */
  meta?: ReactNode;
  /** Optional short status or caption. */
  note?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      {note ? <p className="text-[0.9375rem] leading-snug text-white/90">{note}</p> : null}
      <div className="flex min-w-0 items-center gap-2">
        {/* Nothing on the screen is allowed to outweigh this. */}
        <h2 className="truncate text-[1.625rem] font-bold leading-tight tracking-tight">{title}</h2>
        {badge}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-white/75">{meta}</div>
      ) : null}
    </div>
  );
}

export { HERO_SCRIM_DEFAULT };
