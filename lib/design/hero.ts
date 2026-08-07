/**
 * The Hero Card design system — the decisions, as pure functions.
 *
 * Profiles, Moments, and later Air and Spark all present the same shape: one
 * large image, a progressive blur at its foot, and an identity layer reading
 * over it. What differs between them is content, never geometry — so the
 * geometry lives here, once, and no screen re-derives it.
 *
 * Pure on purpose: adaptive blur is the part most likely to go subtly wrong
 * (unreadable name over a bright sky, a muddy grey veil over a dark one), and
 * a rule you can test with numbers is a rule that stays correct.
 */

/**
 * How bright the foot of the image is, 0 (black) to 1 (white).
 *
 * Supplied by the caller — usually sampled once from the loaded image, or
 * carried on the media record. `null` means unknown, which resolves to the
 * balanced default rather than a guess.
 */
export type HeroLuminance = number | null;

export type HeroScrim = {
  /** Backdrop blur radius in px, applied to the veil only. */
  blurPx: number;
  /** Opacity of the dark gradient over the image, 0–1. */
  scrimOpacity: number;
  /** Text colour that will read against the resolved scrim. */
  tone: "light" | "dark";
  /** Extra text shadow for the brightest cases, or null when unneeded. */
  textShadow: string | null;
};

/**
 * The balanced default: what a Hero uses before it knows anything about the
 * image, and what an unknown luminance resolves to.
 */
export const HERO_SCRIM_DEFAULT: HeroScrim = {
  blurPx: 20,
  scrimOpacity: 0.42,
  tone: "light",
  textShadow: null
};

/** Above this, the image is bright enough that white text needs help. */
const BRIGHT_THRESHOLD = 0.62;
/** Below this, the image is already dark and a heavy scrim would flatten it. */
const DARK_THRESHOLD = 0.28;

/**
 * The scrim for an image of a given foot luminance.
 *
 * The rule, and the reason it is not a fixed overlay:
 *
 *  - BRIGHT image → the veil goes DARKER, not lighter. White text over a pale
 *    sky is the single most common failure of this layout, and adding opacity
 *    is what buys the contrast back.
 *  - DARK image → the veil goes LIGHTER. A dark photo under a heavy black
 *    scrim reads as a dead grey band; the picture is supposed to stay visible
 *    underneath, which is the whole point of a blur rather than a card.
 *  - Blur moves inversely to opacity, so the two never stack into a wall: the
 *    heavier the tint, the softer the blur needs to be to keep the image
 *    legible through it.
 *
 * Interpolated rather than stepped, so a scrolling gallery of mixed images
 * does not visibly jump between three presets.
 */
export function heroScrim(luminance: HeroLuminance): HeroScrim {
  if (luminance === null || Number.isNaN(luminance)) return HERO_SCRIM_DEFAULT;
  const clamped = Math.min(Math.max(luminance, 0), 1);

  if (clamped >= BRIGHT_THRESHOLD) {
    // 0.62 → 1.0 maps to opacity 0.46 → 0.62, blur 20 → 14.
    const t = (clamped - BRIGHT_THRESHOLD) / (1 - BRIGHT_THRESHOLD);
    return {
      blurPx: round(20 - t * 6),
      scrimOpacity: round2(0.46 + t * 0.16),
      tone: "light",
      // Only the extreme end earns a shadow: it costs a paint pass, so it is
      // spent where a scrim alone genuinely cannot hold the contrast.
      textShadow: t > 0.55 ? "0 1px 3px rgb(0 0 0 / 0.45)" : null
    };
  }

  if (clamped <= DARK_THRESHOLD) {
    // 0 → 0.28 maps to opacity 0.20 → 0.34, blur 26 → 22.
    const t = clamped / DARK_THRESHOLD;
    return {
      blurPx: round(26 - t * 4),
      scrimOpacity: round2(0.2 + t * 0.14),
      tone: "light",
      textShadow: null
    };
  }

  // The mid band: 0.28 → 0.62 maps to opacity 0.34 → 0.46, blur 22 → 20.
  const t = (clamped - DARK_THRESHOLD) / (BRIGHT_THRESHOLD - DARK_THRESHOLD);
  return {
    blurPx: round(22 - t * 2),
    scrimOpacity: round2(0.34 + t * 0.12),
    tone: "light",
    textShadow: null
  };
}

/**
 * Average luminance of the bottom band of an image, 0–1.
 *
 * Only the BOTTOM matters: that is the strip the identity layer sits over, and
 * averaging the whole image would let a bright sky wash out a reading of a
 * dark foreground the text actually has to survive.
 *
 * Returns null when the pixels cannot be read — a cross-origin image taints
 * the canvas, and a wrong guess is worse than the balanced default.
 */
export function sampleFootLuminance(
  image: HTMLImageElement,
  documentRef: Document = document
): HeroLuminance {
  try {
    // Tiny sample: 16x4 is plenty for an average and costs almost nothing.
    const canvas = documentRef.createElement("canvas");
    canvas.width = 16;
    canvas.height = 4;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    const source = image.naturalHeight || image.height;
    if (!source) return null;
    // Bottom 30% of the image — the band the blur actually covers.
    const bandHeight = Math.max(1, Math.round(source * 0.3));
    context.drawImage(
      image,
      0,
      source - bandHeight,
      image.naturalWidth || image.width,
      bandHeight,
      0,
      0,
      16,
      4
    );

    const { data } = context.getImageData(0, 0, 16, 4);
    let total = 0;
    let counted = 0;
    for (let index = 0; index < data.length; index += 4) {
      // Rec. 601 luma: matches how bright a colour looks, which is what
      // readability depends on, rather than raw channel average.
      total += (0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!) / 255;
      counted += 1;
    }
    return counted === 0 ? null : total / counted;
  } catch {
    // Tainted canvas (signed media from another origin) or no 2D context.
    return null;
  }
}

/**
 * Parallax offset for the hero image as the page scrolls.
 *
 * The image drifts at a fraction of the scroll so it feels set behind the
 * page rather than glued to it. Capped, because an unbounded offset eventually
 * pulls the image clear of its own frame.
 *
 * Returns 0 under reduced motion — the caller does not need a branch.
 */
export function heroParallaxOffset(
  scrollY: number,
  { reducedMotion = false, factor = 0.28, maxPx = 64 } = {}
): number {
  if (reducedMotion || scrollY <= 0) return 0;
  return Math.min(scrollY * factor, maxPx);
}

/**
 * How far the hero has collapsed, 0 (full) to 1 (fully collapsed).
 *
 * Drives the title handoff: as the hero scrolls away its own name fades out
 * and the compact header title fades in, so exactly one is legible at a time.
 */
export function heroCollapseProgress(scrollY: number, heroHeight: number): number {
  if (heroHeight <= 0) return 0;
  return Math.min(Math.max(scrollY / (heroHeight * 0.6), 0), 1);
}

const round = (value: number) => Math.round(value);
const round2 = (value: number) => Math.round(value * 100) / 100;
