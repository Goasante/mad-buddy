/**
 * Custom glow colours (Buddy Plus / Pro entitlement `custom_glow_styles`).
 *
 * A subscriber may assign a colour to each Muddy so they can tell who is
 * glowing nearby at a glance. This is a curated palette rather than a free hex
 * field on purpose: the swatches are chosen to stay distinct from one another
 * for colour-vision deficiency, they always look good against both themes, and
 * a fixed id can never carry an invalid or malicious value into the CSS.
 *
 * Pure data (no server-only imports) so the picker, the glow renderer, and the
 * server validation all share one source of truth.
 */

export type GlowColor = {
  id: string;
  label: string;
  /** `--halo-color`: an "r g b" triple consumed as rgb(var(--halo-color) / a). */
  rgb: string;
  /** `--halo-ring`: the gradient painted as the solid ring. */
  ring: string;
  /** Swatch fill for the picker. */
  swatch: string;
};

export const GLOW_COLORS: readonly GlowColor[] = [
  { id: "amber", label: "Amber", rgb: "245 158 11", ring: "linear-gradient(135deg, #fbbf24 0%, #d97706 100%)", swatch: "#f59e0b" },
  { id: "rose", label: "Rose", rgb: "244 63 94", ring: "linear-gradient(135deg, #fb7185 0%, #e11d48 100%)", swatch: "#f43f5e" },
  { id: "fuchsia", label: "Fuchsia", rgb: "217 70 239", ring: "linear-gradient(135deg, #e879f9 0%, #c026d3 100%)", swatch: "#d946ef" },
  { id: "violet", label: "Violet", rgb: "139 92 246", ring: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)", swatch: "#8b5cf6" },
  { id: "blue", label: "Blue", rgb: "59 130 246", ring: "linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)", swatch: "#3b82f6" },
  { id: "teal", label: "Teal", rgb: "20 184 166", ring: "linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)", swatch: "#14b8a6" },
  { id: "green", label: "Green", rgb: "34 197 94", ring: "linear-gradient(135deg, #4ade80 0%, #16a34a 100%)", swatch: "#22c55e" },
  { id: "lime", label: "Lime", rgb: "132 204 22", ring: "linear-gradient(135deg, #a3e635 0%, #65a30d 100%)", swatch: "#84cc16" }
] as const;

const GLOW_COLOR_BY_ID = new Map(GLOW_COLORS.map((color) => [color.id, color]));

/** Longest id, so the DB column and the write validator agree on a bound. */
export const GLOW_COLOR_ID_MAX_LENGTH = 16;

export function isGlowColorId(value: unknown): value is string {
  return typeof value === "string" && GLOW_COLOR_BY_ID.has(value);
}

export function glowColorById(id: string | null | undefined): GlowColor | null {
  if (!id) return null;
  return GLOW_COLOR_BY_ID.get(id) ?? null;
}
