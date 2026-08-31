import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPlanCategory,
  planCategoryLabel,
  resolvePlanCover,
  PLAN_CATEGORIES,
  PLAN_COVERS,
  PLAN_COVER_FALLBACK
} from "@/lib/plans/plan-covers";
import type { PlanCategory } from "@/lib/supabase/database.types";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const EXPECTED: PlanCategory[] = [
  "beach", "dinner", "coffee", "study", "movie", "football", "gaming",
  "concert", "birthday", "travel", "workout", "party", "picnic",
  "hiking", "road_trip"
];

// ---------------------------------------------------------------------------
// Priority chain
// ---------------------------------------------------------------------------

describe("resolvePlanCover priority", () => {
  it("prefers a user upload over everything else", () => {
    const cover = resolvePlanCover({ category: "beach", coverImageUrl: "https://cdn/x.jpg" });
    expect(cover.source).toBe("upload");
    expect(cover.imageUrl).toBe("https://cdn/x.jpg");
  });

  it("falls to the canonical illustration when there is no upload", () => {
    const cover = resolvePlanCover({ category: "gaming", coverImageUrl: null });
    expect(cover.source).toBe("canonical");
    expect(cover.art).toEqual(PLAN_COVERS.gaming);
  });

  it("falls to the branded fallback when there is neither", () => {
    const cover = resolvePlanCover({ category: null, coverImageUrl: null });
    expect(cover.source).toBe("fallback");
    expect(cover.art).toEqual(PLAN_COVER_FALLBACK);
  });

  it("treats a blank or whitespace-only upload as absent", () => {
    expect(resolvePlanCover({ category: "beach", coverImageUrl: "" }).source).toBe("canonical");
    expect(resolvePlanCover({ category: "beach", coverImageUrl: "   " }).source).toBe("canonical");
    expect(resolvePlanCover({ coverImageUrl: "  " }).source).toBe("fallback");
  });

  it("always returns a cover, whatever the input", () => {
    for (const input of [{}, { category: null }, { coverImageUrl: null }, { category: "nonsense" }]) {
      expect(resolvePlanCover(input).source).toBeTruthy();
    }
  });

  it("falls back rather than throwing on an unknown category", () => {
    const cover = resolvePlanCover({ category: "underwater_basket_weaving" });
    expect(cover.source).toBe("fallback");
  });

  it("never guesses a category from the title", () => {
    const source = read("lib/plans/plan-covers.ts");
    // The resolver's input shape has no title field, and there is no keyword
    // matching anywhere in the module.
    expect(source).not.toMatch(/title\??:/);
    expect(source).not.toMatch(/\.test\(/);
    expect(source).not.toContain("match:");
    // Behavioural proof: a beach-themed title with no category still falls back.
    expect(resolvePlanCover({ category: null }).source).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("plan cover registry", () => {
  it("covers every category in the spec", () => {
    expect(PLAN_CATEGORIES.sort()).toEqual([...EXPECTED].sort());
  });

  it("gives every category its own art and label", () => {
    for (const category of PLAN_CATEGORIES) {
      expect(PLAN_COVERS[category], `${category} has no art`).toBeTruthy();
      expect(planCategoryLabel(category), `${category} has no label`).toBeTruthy();
    }
  });

  it("defines each cover as two gradient stops plus a motif", () => {
    for (const category of PLAN_CATEGORIES) {
      const art = PLAN_COVERS[category];
      expect(art.from).toMatch(/^#[0-9a-f]{6}$/i);
      expect(art.to).toMatch(/^#[0-9a-f]{6}$/i);
      expect(art.motif).toBeTruthy();
    }
  });

  it("keeps the registry in sync with the database constraint", () => {
    const migration = read("supabase/migrations/20260806120000_plan_covers.sql");
    for (const category of PLAN_CATEGORIES) {
      expect(migration, `${category} missing from the check constraint`).toContain(`'${category}'`);
    }
  });

  it("keeps the registry in sync with the PlanCategory type", () => {
    const types = read("lib/supabase/database.types.ts");
    const block = types.slice(types.indexOf("export type PlanCategory"), types.indexOf("export type PlanStatus"));
    for (const category of PLAN_CATEGORIES) {
      expect(block, `${category} missing from PlanCategory`).toContain(`"${category}"`);
    }
  });

  it("narrows unknown strings safely", () => {
    expect(isPlanCategory("beach")).toBe(true);
    expect(isPlanCategory("toString")).toBe(false);
    expect(isPlanCategory("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Assets: no stock, no external fetches, no generation
// ---------------------------------------------------------------------------

describe("plan cover assets", () => {
  const component = read("components/plans/plan-cover.tsx");

  it("draws canonical covers locally rather than fetching them", () => {
    expect(component).toContain("<svg");
    // No remote hosts for canonical art.
    const canonical = component.slice(component.indexOf("function CoverArt"));
    expect(canonical).not.toContain("http");
  });

  it("never renders a map, a profile picture or a stock photo", () => {
    for (const banned of ["mapbox", "googleapis", "unsplash", "pexels", "avatarUrl", "/maps"]) {
      expect(component, `must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("uses a branded fallback, not a generic grey gradient", () => {
    // Mad Buddy's own magenta, and the concentric-proximity mark.
    expect(PLAN_COVER_FALLBACK.from).toBe("#b81a5c");
    expect(PLAN_COVER_FALLBACK.motif).toBe("mark");
  });
});

// ---------------------------------------------------------------------------
// One resolver, used everywhere
// ---------------------------------------------------------------------------

describe("plan cover architecture", () => {
  it("exposes exactly one resolver", () => {
    const source = read("lib/plans/plan-covers.ts");
    expect(source).toContain("export function resolvePlanCover");
  });

  it("is the only thing that decides a cover — surfaces just pass fields", () => {
    // Every surface that shows plans, whether it renders a cover itself or
    // delegates to a shared card. The guarantee is that NONE of them resolves
    // or styles a cover of its own.
    for (const path of [
      "components/dashboard/dashboard-page.tsx",
      "components/plans/plans-page.tsx",
      "components/socialize/plan-stack.tsx"
    ]) {
      const surface = read(path);
      expect(surface, `${path} must not call the resolver directly`).not.toContain("resolvePlanCover(");
      expect(surface, `${path} must not hardcode cover art`).not.toContain("PLAN_COVERS[");
    }

    // The Plans page still renders the canonical component directly; Home and
    // Linkr both go through SocializePlanCard, which does the same.
    expect(read("components/plans/plans-page.tsx")).toContain("<PlanCover");
    expect(read("components/socialize/socialize-plan-card.tsx")).toContain("resolvePlanCover(plan)");
  });

  it("routes the component through the resolver", () => {
    expect(read("components/plans/plan-cover.tsx")).toContain("resolvePlanCover({ category, coverImageUrl })");
  });

  it("hardcodes no image paths in the UI", () => {
    for (const path of ["components/dashboard/dashboard-page.tsx", "components/plans/plans-page.tsx"]) {
      expect(read(path)).not.toMatch(/\/covers\/\w+\.(png|jpe?g|webp|svg)/);
    }
  });

  it("drops the old title-keyword icon guessing", () => {
    const plans = read("components/plans/plans-page.tsx");
    expect(plans).not.toContain("PLAN_ICON_RULES");
    expect(plans).not.toContain("planIcon(");
  });

  it("lets a new cover type ship without touching a UI component", () => {
    // The component switches on the motif union; adding a category means a
    // registry entry (+ a motif if it needs new geometry), never a change to
    // the surfaces that render covers.
    const component = read("components/plans/plan-cover.tsx");
    expect(component).toContain("switch (motif)");
    expect(component).toContain("case \"mark\":");
    expect(component).toContain("default:");
  });
});

// ---------------------------------------------------------------------------
// Projection + creation
// ---------------------------------------------------------------------------

describe("plan cover data flow", () => {
  it("carries both cover fields on the Home projection", () => {
    const service = read("lib/social/upcoming-plans.ts");
    expect(service).toContain("category: PlanCategory | null");
    expect(service).toContain("coverImageUrl: string | null");
    expect(service).toContain("category, cover_image_url");
  });

  it("carries both cover fields on the Plans projection", () => {
    expect(read("lib/plans/service.ts")).toContain("category, cover_image_url");
    expect(read("app/(app)/plans/page.tsx")).toContain("category, cover_image_url");
  });

  it("validates the created category against the registry", () => {
    const service = read("lib/plans/service.ts");
    expect(service).toContain("z.enum(PLAN_CATEGORIES");
    expect(service).toContain("category: parsed.data.category ?? null");
  });

  it("keeps the category optional end to end", () => {
    const migration = read("supabase/migrations/20260806120000_plan_covers.sql");
    expect(migration).toContain("category is null or category in");
    expect(read("lib/plans/service.ts")).toContain(".nullable().optional()");
  });

  it("offers a picker rather than inferring the category", () => {
    /* The picker is still a picker; only the visible slice shrank. All fifteen
     * chips wrapped across several rows and became the tallest thing in the
     * composer, so six show and the rest sit behind "More" -- reduced on
     * screen, never removed from the model or inferred from the title. */
    const page = read("components/plans/plans-page.tsx");
    expect(page).toContain("shownCategories.map");
    expect(page).toContain("if (showAllCategories) return PLAN_CATEGORIES;");
    expect(page).toContain("setCategory(active ? null : option)");
  });
});
