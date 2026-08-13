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
 * These are the real supplied black/white variants. No CSS filter or colour
 * replacement is used. Square output keeps sizing predictable.
 */
export const brandSymbol = {
  light: { src: "/brand/mad-buddy-mark-light.png", width: 512, height: 512 },
  dark: { src: "/brand/mad-buddy-mark-dark.png", width: 512, height: 512 }
} as const satisfies Record<string, BrandAsset>;

export type BrandNavigationIconName = "linkr" | "upfor";

/** Approved state-specific navigation artwork. Never tinted or filtered. */
export const brandNavigationIcons = {
  linkr: {
    active: { src: "/icons/navigation/linkr-active.png", width: 64, height: 64 },
    inactive: { src: "/icons/navigation/linkr-inactive.png", width: 64, height: 64 }
  },
  upfor: {
    active: { src: "/icons/navigation/upfor-active.png", width: 64, height: 64 },
    inactive: { src: "/icons/navigation/upfor-inactive.png", width: 64, height: 64 }
  }
} as const satisfies Record<BrandNavigationIconName, Record<"active" | "inactive", BrandAsset>>;
