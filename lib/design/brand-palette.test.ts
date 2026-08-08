import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Brand palette and Linkr attribution.
 *
 * Two things guarded here, both of which regress silently:
 *
 *  1. A hardcoded colour that bypasses the tokens still renders — it just
 *     renders the OLD brand, leaving the app half-migrated.
 *  2. Linkr copy that claims recommendation. Socialize returns everyone opted
 *     in nearby, ordered by proximity and presence; there is no ranking model.
 *     "Linkr recommends" would overstate the product the same way the removed
 *     "Verified" chip did.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const css = read("app/globals.css");
const hero = stripComments(read("components/socialize/socialize-hero.tsx"));
const feed = stripComments(read("components/socialize/discovery-feed.tsx"));
const rails = stripComments(read("components/socialize/discovery-rails.tsx"));

/** Every source file a colour could hide in. */
const SOURCE_FILES = [
  "app/globals.css",
  "components/dashboard/dashboard-page.tsx",
  "components/settings/appearance-page.tsx",
  "lib/plans/plan-covers.ts"
];

describe("brand palette", () => {
  it("uses Orange Grove as the primary", () => {
    expect(css).toContain("--color-brand-orange: #e88c2b;");
    // hsl equivalent, so every component inheriting the token moves with it.
    expect(css).toContain("--primary: 31 81% 54%;");
  });

  it("uses Calming White as the light ground", () => {
    // A warm paper ground, not a cool blue-white.
    expect(css).toContain("--background: 41 71% 98%;");
    expect(css).toContain("--bg-primary: #fefbf3;");
  });

  it("uses Dark Maroon as the accent, never as a second primary", () => {
    expect(css).toContain("--color-brand-maroon: #4e0401;");
    expect(css).toContain("--accent: 3 97% 16%;");
    // Two competing warm hues at full strength would flatten the hierarchy.
    expect(css).not.toContain("--primary: 3 97% 16%;");
  });

  it("RETIRES the previous orange everywhere", () => {
    // A single survivor leaves the app looking half-migrated.
    for (const file of SOURCE_FILES) {
      const source = read(file);
      for (const legacy of ["#f97316", "#fb923c", "#ea580c", "249, 115, 22", "249 115 22"]) {
        expect(source, `${file} still contains the legacy colour ${legacy}`).not.toContain(legacy);
      }
    }
  });

  it("warms the dark surfaces instead of using pure black", () => {
    // Pure black crushes a warm palette and makes the orange read as neon.
    expect(css).toContain("--background: 8 18% 8%;");
    expect(css).not.toContain("--background: 0 0% 0%;");
  });

  it("tints dark elevation toward the maroon", () => {
    expect(css).toContain("--shadow: 3 70% 4%;");
  });

  it("keeps the focus ring on the primary, so focus stays visible", () => {
    expect(css).toContain("--ring: 31 81% 54%;");
  });

  it("moves the glow with the new primary", () => {
    expect(css).toContain("rgb(232 140 43 / 0.3)");
    expect(css).toContain("rgba(232, 140, 43, 0.24)");
  });
});

describe("Linkr branding", () => {
  it("names the page Linkr", () => {
    // Linkr is now the product name for this surface, not just the engine
    // behind it, so the page title carries it and the redundant "Powered by"
    // footer was removed.
    expect(feed).toContain(">Linkr</h1>");
    expect(feed).not.toContain("Powered by Linkr");
  });

  it("NEVER claims recommendation", () => {
    // There is no ranking model behind this surface: it returns everyone
    // opted in nearby, ordered by proximity and presence. Every one of these
    // verbs would promise intelligence the product does not have.
    const surfaces = hero + feed + rails;
    for (const overclaim of ["Linkr recommends", "Linkr suggests", "Linkr discovered", "recommended for you"]) {
      expect(surfaces, `copy must not claim "${overclaim}"`).not.toContain(overclaim);
    }
  });

  it("describes what the surface actually does", () => {
    expect(feed).toContain("Find people nearby who are open to connecting");
  });

  it("attributes the empty states honestly", () => {
    expect(rails).toContain("Groups are private unless someone lists them");
    expect(rails).toContain("Linkr brings your upcoming plans here");
  });

  it("leaves internal identifiers alone", () => {
    // Route paths, feature-flag keys and icon keys are identifiers, not copy.
    // Renaming them would break links, flags and tour targets for a cosmetic
    // change.
    const shell = stripComments(read("components/app-shell/app-shell.tsx"));
    expect(shell).toContain('href: "/discover"');
    expect(shell).toContain('featureIcon: "socialize"');
  });
});
