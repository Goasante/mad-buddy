/**
 * The approved Mad Buddy brand assets, in one place.
 *
 * Every surface references these constants rather than a raw
 * "/brand/something.png" string, so replacing the identity again is one edit
 * here instead of a search across dozens of components.
 *
 * All dimensions are the INTRINSIC size of the derivative on disk. They are
 * exported alongside each path because next/image needs real numbers to
 * reserve space, and guessing them is how a logo ends up stretched.
 *
 * DERIVED, NOT REDRAWN. Each file under /brand and /icons was produced from
 * the supplied artwork by cropping empty canvas and resizing -- no recolour,
 * no trace, no reconstruction.
 */

export type BrandAsset = {
  src: string;
  width: number;
  height: number;
};

/**
 * The horizontal lockup: mark plus wordmark.
 *
 * TWO REAL VARIANTS, not one asset with a CSS filter. `light` is drawn for
 * light backgrounds, `dark` for dark ones; inverting either would change
 * artwork the brand approved.
 */
export const brandLogo = {
  light: { src: "/brand/mad-buddy-logo-light.png", width: 1128, height: 256 },
  dark: { src: "/brand/mad-buddy-logo-dark.png", width: 1128, height: 256 }
} as const satisfies Record<string, BrandAsset>;

/**
 * The standalone symbol, for square and tight spaces.
 *
 * RECOLOURED TO MAD BUDDY ORANGE. The supplied marks are pure black -- their
 * "light"/"dark" names describe the background they were drawn for, not their
 * own colour -- which rendered as a near-invisible smudge on the dark chrome
 * and as an unbranded black blob elsewhere. Recoloured by replacing RGB and
 * keeping alpha, so the drawing is untouched.
 *
 * Square, so a caller sizes it with one height and width pair.
 */
export const brandSymbol = {
  light: { src: "/brand/mad-buddy-mark-light.png", width: 512, height: 512 },
  dark: { src: "/brand/mad-buddy-mark-dark.png", width: 512, height: 512 }
} as const satisfies Record<string, BrandAsset>;

/**
 * NAVIGATION ICONS ARE NOT PART OF THIS LAYER, deliberately.
 *
 * The pack supplies Linkr and UpFor as active/inactive PNGs, and they were
 * wired in and then reverted. Measured, they are DENSE drawings -- 33-49% of
 * their box is inked -- while the lucide icons beside them are thin 2px
 * strokes at roughly 14%. Matching bounding boxes therefore made them read
 * smaller and heavier than their neighbours, because the eye compares drawn
 * mass rather than boxes, and scaling only partly hid the mismatch.
 *
 * The nav keeps its stroke-drawn SVG icons, which sit at the same visual
 * weight as every other tab and inherit --primary / --muted-foreground in
 * both themes natively. The supplied artwork remains the source of truth for
 * the logo, favicon, PWA, app icon, splash and social image above.
 *
 * The originals are preserved in brand-assets-source/navigation-icons/ should
 * stroke-weight versions ever be supplied.
 */
