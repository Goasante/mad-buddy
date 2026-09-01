import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Wallpaper personalization — the pure, deterministic core.
 *
 * Everything about *which* wallpaper a user is allowed to see and what the app
 * should render lives here so it can be unit-tested and is identical on the
 * server (authoritative) and any client preview. No IO, no Supabase.
 *
 * Three render modes:
 *  - "ambient": the theme-adaptive Mad Buddy Default (a CSS-masked SVG that
 *    paints a theme token, so it needs no image and works in light + dark).
 *  - "plain":   the clean design-system background, no artwork.
 *  - "image":   a bundled/managed/custom raster with optional light + dark
 *    variants that switch with the app theme.
 *
 * Tier access is hierarchical and reuses the same plan ranking billing uses:
 * a Free wallpaper is available to everyone; a Buddy Plus wallpaper to Plus and
 * Pro; a Buddy Pro wallpaper to Pro only.
 */

export type WallpaperTier = "free" | "buddy_plus" | "buddy_pro";
export type WallpaperRenderMode = "ambient" | "plain" | "image";
export type WallpaperSource = "bundled" | "managed" | "custom";

export type WallpaperCatalogEntry = {
  /** Stable identity. Bundled entries use their slug; managed rows use a uuid. */
  id: string;
  slug: string;
  name: string;
  renderMode: WallpaperRenderMode;
  tier: WallpaperTier;
  /** Small preview for the picker (null for ambient/plain, which self-render). */
  thumbUrl: string | null;
  /** Image-mode sources; either may be null and falls back to the other. */
  lightUrl: string | null;
  darkUrl: string | null;
  isEnabled: boolean;
  sortOrder: number;
  source: WallpaperSource;
};

/** What the renderer needs — never leaks tier/enabled internals to the DOM. */
export type ResolvedWallpaper = {
  slug: string;
  renderMode: WallpaperRenderMode;
  lightUrl: string | null;
  darkUrl: string | null;
  /** True when we fell back because the chosen wallpaper was ineligible/gone. */
  fellBack: boolean;
};

export const DEFAULT_WALLPAPER_SLUG = "mad-buddy-default";
export const PLAIN_WALLPAPER_SLUG = "plain";

/** The masked ambient SVG lives at a stable public path (theme-adaptive). */
export const AMBIENT_WALLPAPER_ASSET = "/wallpapers/mad-buddy-default.svg";

const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

const TIER_RANK: Record<WallpaperTier, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

export const WALLPAPER_TIERS: readonly WallpaperTier[] = ["free", "buddy_plus", "buddy_pro"];

export function isWallpaperTier(value: string): value is WallpaperTier {
  return (WALLPAPER_TIERS as readonly string[]).includes(value);
}

/** Hierarchical access: a plan reaches its own tier and every lower one. */
export function canAccessTier(_plan: SubscriptionPlan, _tier: WallpaperTier): boolean {
  return true; // ACCESS_CONVERGENCE: wallpaper choice is free core.
}

/** The minimum plan a tier requires (for upgrade prompts / labels). */
export function requiredPlanForTier(_tier: WallpaperTier): SubscriptionPlan {
  return "free";
}

/**
 * The canonical bundled catalog. It seeds the database migration AND acts as a
 * safe in-memory fallback so the picker and background still work if the
 * wallpapers table is empty or unreachable (failure must never break Home).
 *
 * The Mad Buddy Default is the theme-adaptive ambient art; Plain is the raw
 * background; the four gallery photos are Free and optimized (see
 * public/wallpapers/gallery). Managed and custom wallpapers are layered on top
 * of this at runtime from the database.
 */
export const BUNDLED_WALLPAPERS: readonly WallpaperCatalogEntry[] = [
  {
    id: DEFAULT_WALLPAPER_SLUG,
    slug: DEFAULT_WALLPAPER_SLUG,
    name: "Mad Buddy Default",
    renderMode: "ambient",
    tier: "free",
    thumbUrl: null,
    lightUrl: null,
    darkUrl: null,
    isEnabled: true,
    sortOrder: 0,
    source: "bundled"
  },
  {
    id: PLAIN_WALLPAPER_SLUG,
    slug: PLAIN_WALLPAPER_SLUG,
    name: "Plain",
    renderMode: "plain",
    tier: "free",
    thumbUrl: null,
    lightUrl: null,
    darkUrl: null,
    isEnabled: true,
    sortOrder: 1,
    source: "bundled"
  },
  ...[1, 2, 3, 4].map((n): WallpaperCatalogEntry => {
    const slug = `wallpaper-0${n}`;
    return {
      id: slug,
      slug,
      name: `Wallpaper ${n}`,
      renderMode: "image",
      tier: "free",
      thumbUrl: `/wallpapers/gallery/thumbs/${slug}.webp`,
      lightUrl: `/wallpapers/gallery/${slug}.webp`,
      darkUrl: `/wallpapers/gallery/${slug}.webp`,
      isEnabled: true,
      sortOrder: 1 + n,
      source: "bundled"
    };
  })
];

export function defaultResolvedWallpaper(fellBack = false): ResolvedWallpaper {
  return {
    slug: DEFAULT_WALLPAPER_SLUG,
    renderMode: "ambient",
    lightUrl: null,
    darkUrl: null,
    fellBack
  };
}

function toResolved(entry: WallpaperCatalogEntry, fellBack: boolean): ResolvedWallpaper {
  return {
    slug: entry.slug,
    renderMode: entry.renderMode,
    // Each image variant falls back to the other so a wallpaper with only one
    // variant never renders a broken/empty background in the other theme.
    lightUrl: entry.lightUrl ?? entry.darkUrl,
    darkUrl: entry.darkUrl ?? entry.lightUrl,
    fellBack
  };
}

export type CustomWallpaperState = {
  /** Signed/served URL for the owner's uploaded image, if one is active. */
  url: string | null;
  isActive: boolean;
};

/**
 * The single decision that turns a stored preference into what actually
 * renders. Deliberately fail-safe: any ineligible, disabled, unknown, or
 * unentitled choice collapses to Mad Buddy Default, then Plain — never a broken
 * background. This is server-authoritative; the client only mirrors it.
 */
export function resolveEffectiveWallpaper(input: {
  catalog: readonly WallpaperCatalogEntry[];
  plan: SubscriptionPlan;
  /** The user's stored selection slug, or the sentinel "custom". */
  selectedSlug: string | null;
  custom?: CustomWallpaperState | null;
}): ResolvedWallpaper {
  const { catalog, plan, selectedSlug } = input;

  // Custom personal wallpaper — premium only, and only while still entitled.
  if (selectedSlug === "custom") {
    const custom = input.custom;
    if (custom?.isActive && custom.url) {
      return { slug: "custom", renderMode: "image", lightUrl: custom.url, darkUrl: custom.url, fellBack: false };
    }
    // Downgraded (Free) or missing upload → safe fallback, do not delete data.
    return defaultResolvedWallpaper(true);
  }

  if (selectedSlug) {
    const entry = catalog.find((item) => item.slug === selectedSlug);
    if (entry && entry.isEnabled && canAccessTier(plan, entry.tier)) {
      return toResolved(entry, false);
    }
    // Chosen wallpaper was disabled/retired/unentitled → fall back.
    if (entry || selectedSlug !== DEFAULT_WALLPAPER_SLUG) {
      return resolveDefaultOrPlain(catalog, true);
    }
  }

  // No stored preference → Mad Buddy Default.
  return resolveDefaultOrPlain(catalog, false);
}

function resolveDefaultOrPlain(catalog: readonly WallpaperCatalogEntry[], fellBack: boolean): ResolvedWallpaper {
  const def = catalog.find((item) => item.slug === DEFAULT_WALLPAPER_SLUG);
  if (def && def.isEnabled) return toResolved(def, fellBack);
  const plain = catalog.find((item) => item.slug === PLAIN_WALLPAPER_SLUG);
  if (plain) return toResolved(plain, true);
  // The bundled default always exists; this is the last-resort guarantee.
  return defaultResolvedWallpaper(true);
}

/**
 * The catalog a given user should see in the picker: enabled wallpapers plus a
 * per-entry `locked` flag when the wallpaper is above the user's plan. Locked
 * entries stay visible (so upgrade is discoverable) but are not selectable.
 */
export type PickerWallpaper = WallpaperCatalogEntry & {
  locked: boolean;
  requiredPlan: SubscriptionPlan;
};

export function buildPickerCatalog(
  catalog: readonly WallpaperCatalogEntry[],
  plan: SubscriptionPlan
): PickerWallpaper[] {
  return catalog
    .filter((entry) => entry.isEnabled)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((entry) => ({
      ...entry,
      locked: !canAccessTier(plan, entry.tier),
      requiredPlan: requiredPlanForTier(entry.tier)
    }));
}
