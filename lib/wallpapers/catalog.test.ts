import { describe, expect, it } from "vitest";
import {
  BUNDLED_WALLPAPERS,
  buildPickerCatalog,
  canAccessTier,
  DEFAULT_WALLPAPER_SLUG,
  PLAIN_WALLPAPER_SLUG,
  requiredPlanForTier,
  resolveEffectiveWallpaper,
  type WallpaperCatalogEntry
} from "@/lib/wallpapers/catalog";

const catalog: WallpaperCatalogEntry[] = [
  ...BUNDLED_WALLPAPERS,
  {
    id: "plus-1",
    slug: "plus-aurora",
    name: "Aurora",
    renderMode: "image",
    tier: "buddy_plus",
    thumbUrl: "/t.webp",
    lightUrl: "/l.webp",
    darkUrl: "/d.webp",
    isEnabled: true,
    sortOrder: 10,
    source: "managed"
  },
  {
    id: "pro-1",
    slug: "pro-nebula",
    name: "Nebula",
    renderMode: "image",
    tier: "buddy_pro",
    thumbUrl: "/t2.webp",
    lightUrl: "/l2.webp",
    darkUrl: null,
    isEnabled: true,
    sortOrder: 11,
    source: "managed"
  },
  {
    id: "disabled-1",
    slug: "retired-one",
    name: "Retired",
    renderMode: "image",
    tier: "free",
    thumbUrl: "/t3.webp",
    lightUrl: "/l3.webp",
    darkUrl: "/l3.webp",
    isEnabled: false,
    sortOrder: 12,
    source: "managed"
  }
];

describe("wallpaper tier access", () => {
  it("is hierarchical: higher plans reach lower tiers", () => {
    expect(canAccessTier("free", "free")).toBe(true);
    expect(canAccessTier("free", "buddy_plus")).toBe(false);
    expect(canAccessTier("free", "buddy_pro")).toBe(false);

    expect(canAccessTier("buddy_plus", "free")).toBe(true);
    expect(canAccessTier("buddy_plus", "buddy_plus")).toBe(true);
    expect(canAccessTier("buddy_plus", "buddy_pro")).toBe(false);

    expect(canAccessTier("buddy_pro", "free")).toBe(true);
    expect(canAccessTier("buddy_pro", "buddy_plus")).toBe(true);
    expect(canAccessTier("buddy_pro", "buddy_pro")).toBe(true);
  });

  it("maps tiers to the required plan", () => {
    expect(requiredPlanForTier("free")).toBe("free");
    expect(requiredPlanForTier("buddy_plus")).toBe("buddy_plus");
    expect(requiredPlanForTier("buddy_pro")).toBe("buddy_pro");
  });
});

describe("resolveEffectiveWallpaper", () => {
  it("gives Mad Buddy Default when there is no preference", () => {
    const r = resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: null });
    expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(r.renderMode).toBe("ambient");
    expect(r.fellBack).toBe(false);
  });

  it("lets a Free user select Plain and Free wallpapers", () => {
    expect(resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: PLAIN_WALLPAPER_SLUG }).renderMode).toBe(
      "plain"
    );
    const free = resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "wallpaper-01" });
    expect(free.slug).toBe("wallpaper-01");
    expect(free.lightUrl).toContain("wallpaper-01.webp");
    expect(free.fellBack).toBe(false);
  });

  it("blocks a Free user from a Plus/Pro wallpaper and falls back safely", () => {
    const plus = resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "plus-aurora" });
    expect(plus.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(plus.fellBack).toBe(true);

    const pro = resolveEffectiveWallpaper({ catalog, plan: "buddy_plus", selectedSlug: "pro-nebula" });
    expect(pro.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(pro.fellBack).toBe(true);
  });

  it("lets entitled users use Plus/Pro wallpapers", () => {
    expect(resolveEffectiveWallpaper({ catalog, plan: "buddy_plus", selectedSlug: "plus-aurora" }).slug).toBe(
      "plus-aurora"
    );
    expect(resolveEffectiveWallpaper({ catalog, plan: "buddy_pro", selectedSlug: "pro-nebula" }).slug).toBe(
      "pro-nebula"
    );
  });

  it("fills a missing image variant from the other theme", () => {
    const pro = resolveEffectiveWallpaper({ catalog, plan: "buddy_pro", selectedSlug: "pro-nebula" });
    expect(pro.lightUrl).toBe("/l2.webp");
    expect(pro.darkUrl).toBe("/l2.webp"); // dark was null → falls back to light
  });

  it("falls back when the selected wallpaper is disabled/retired", () => {
    const r = resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "retired-one" });
    expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(r.fellBack).toBe(true);
  });

  it("falls back when the selected slug is unknown", () => {
    const r = resolveEffectiveWallpaper({ catalog, plan: "free", selectedSlug: "does-not-exist" });
    expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(r.fellBack).toBe(true);
  });

  describe("custom personal wallpaper (premium)", () => {
    it("applies for an entitled user with an active upload", () => {
      const r = resolveEffectiveWallpaper({
        catalog,
        plan: "buddy_plus",
        selectedSlug: "custom",
        custom: { url: "https://signed/x.webp", isActive: true }
      });
      expect(r.slug).toBe("custom");
      expect(r.renderMode).toBe("image");
      expect(r.lightUrl).toBe("https://signed/x.webp");
      expect(r.fellBack).toBe(false);
    });

    it("does not apply for a Free user (downgrade) — safe fallback, data kept", () => {
      const r = resolveEffectiveWallpaper({
        catalog,
        plan: "free",
        selectedSlug: "custom",
        custom: { url: "https://signed/x.webp", isActive: true }
      });
      expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
      expect(r.fellBack).toBe(true);
    });

    it("falls back when custom is selected but no upload exists", () => {
      const r = resolveEffectiveWallpaper({ catalog, plan: "buddy_pro", selectedSlug: "custom", custom: null });
      expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
      expect(r.fellBack).toBe(true);
    });
  });

  it("survives an empty/broken catalog without throwing", () => {
    const r = resolveEffectiveWallpaper({ catalog: [], plan: "free", selectedSlug: "wallpaper-01" });
    expect(r.slug).toBe(DEFAULT_WALLPAPER_SLUG);
    expect(r.renderMode).toBe("ambient");
  });
});

describe("buildPickerCatalog", () => {
  it("hides disabled entries, locks above-plan tiers, keeps sort order", () => {
    const picker = buildPickerCatalog(catalog, "free");
    expect(picker.some((entry) => entry.slug === "retired-one")).toBe(false); // disabled hidden
    const aurora = picker.find((entry) => entry.slug === "plus-aurora");
    expect(aurora?.locked).toBe(true);
    expect(aurora?.requiredPlan).toBe("buddy_plus");
    const def = picker.find((entry) => entry.slug === DEFAULT_WALLPAPER_SLUG);
    expect(def?.locked).toBe(false);
    // Sorted ascending by sortOrder → default first.
    expect(picker[0]?.slug).toBe(DEFAULT_WALLPAPER_SLUG);
  });

  it("unlocks Plus wallpapers for a Plus user but still locks Pro", () => {
    const picker = buildPickerCatalog(catalog, "buddy_plus");
    expect(picker.find((entry) => entry.slug === "plus-aurora")?.locked).toBe(false);
    expect(picker.find((entry) => entry.slug === "pro-nebula")?.locked).toBe(true);
  });
});
