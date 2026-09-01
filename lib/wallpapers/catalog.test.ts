import { describe, expect, it } from "vitest";
import {
  BUNDLED_WALLPAPERS,
  buildPickerCatalog,
  canAccessTier,
  DEFAULT_WALLPAPER_SLUG,
  requiredPlanForTier,
  resolveEffectiveWallpaper,
  type WallpaperCatalogEntry
} from "@/lib/wallpapers/catalog";

const catalog: WallpaperCatalogEntry[] = [
  ...BUNDLED_WALLPAPERS,
  { id: "legacy-plus", slug: "legacy-plus", name: "Aurora", renderMode: "image", tier: "buddy_plus", thumbUrl: "/t.webp", lightUrl: "/l.webp", darkUrl: "/d.webp", isEnabled: true, sortOrder: 10, source: "managed" },
  { id: "legacy-pro", slug: "legacy-pro", name: "Nebula", renderMode: "image", tier: "buddy_pro", thumbUrl: "/t2.webp", lightUrl: "/l2.webp", darkUrl: null, isEnabled: true, sortOrder: 11, source: "managed" }
];

describe("wallpaper access convergence", () => {
  it("treats historical tier tags as catalog metadata, not consumer gates", () => {
    for (const plan of ["free", "buddy_plus", "buddy_pro"] as const) {
      expect(canAccessTier(plan, "free")).toBe(true);
      expect(canAccessTier(plan, "buddy_plus")).toBe(true);
      expect(canAccessTier(plan, "buddy_pro")).toBe(true);
    }
    expect(requiredPlanForTier("buddy_plus")).toBe("free");
    expect(requiredPlanForTier("buddy_pro")).toBe("free");
  });

  it("lets a free-core account resolve every enabled managed wallpaper", () => {
    expect(resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "legacy-plus" }).slug).toBe("legacy-plus");
    expect(resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "legacy-pro" }).slug).toBe("legacy-pro");
  });

  it("lets a free-core account use an active custom wallpaper", () => {
    const resolved = resolveEffectiveWallpaper({
      catalog,
      plan: "free",
      selectedSlug: "custom",
      custom: { url: "https://signed/x.webp", isActive: true }
    });
    expect(resolved.slug).toBe("custom");
    expect(resolved.lightUrl).toBe("https://signed/x.webp");
  });

  it("builds a picker with no monetization locks", () => {
    const picker = buildPickerCatalog(catalog, "free");
    expect(picker.every((entry) => entry.locked === false)).toBe(true);
    expect(picker.every((entry) => entry.requiredPlan === "free")).toBe(true);
    expect(picker[0]?.slug).toBe(DEFAULT_WALLPAPER_SLUG);
  });
});
