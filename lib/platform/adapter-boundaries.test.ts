import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The adapter's boundary contract, pinned to source.
 *
 * The whole point of lib/platform is that ONE seam decides what each platform
 * gets. If a .mobile file imported next/* the mobile bundle would fail to
 * build; if a web file stopped re-exporting the real Next component, web would
 * silently lose typed routes and the optimizer. Both are the kind of mistake a
 * later "tidy-up" makes, so both are asserted here.
 */

const read = (path: string) => readFileSync(path, "utf8");

const MOBILE_FILES = [
  "lib/platform/link.mobile.tsx",
  "lib/platform/image.mobile.tsx",
  "lib/platform/router.mobile.ts",
  "lib/platform/routes.mobile.ts",
  "lib/platform/index.mobile.ts"
];

const WEB_FILES = [
  "lib/platform/link.tsx",
  "lib/platform/image.tsx",
  "lib/platform/router.ts",
  "lib/platform/revalidate.ts",
  "lib/platform/index.ts"
];

describe("no mobile implementation may touch Next", () => {
  it.each(MOBILE_FILES)("%s imports nothing from next/*", (path) => {
    expect(read(path)).not.toMatch(/from\s+["']next\//);
  });

  it.each(MOBILE_FILES)("%s imports no server-only module", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/["']server-only["']/);
    expect(source).not.toMatch(/@\/lib\/supabase\/(server|admin)/);
    // A "use server" action module would drag the server graph in -- the
    // exact failure that broke the mobile build in PR #84.
    expect(source).not.toMatch(/@\/app\//);
  });
});

describe("web implementations stay verbatim re-exports", () => {
  it("Link re-exports next/link rather than wrapping it", () => {
    // A hand-written wrapper typed `href: string` would disable typedRoutes
    // across the 49 files that rely on `as Route`.
    expect(read("lib/platform/link.tsx")).toContain('export { default as Link } from "next/link"');
  });

  it("Image re-exports next/image, keeping the optimizer", () => {
    expect(read("lib/platform/image.tsx")).toContain('export { default as Image } from "next/image"');
  });

  it("router re-exports next/navigation", () => {
    expect(read("lib/platform/router.ts")).toMatch(
      /export \{ useRouter, usePathname, useSearchParams \} from "next\/navigation"/
    );
  });
});

describe("the two barrels expose the same surface", () => {
  // A component that compiles on web must compile for mobile. Divergence here
  // is caught by the mobile CI job, but failing in this suite names the cause.
  const named = (source: string) =>
    [...source.matchAll(/export \{([^}]*)\} from/g)]
      .flatMap((match) => match[1].split(","))
      .map((entry) => entry.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();

  it("exports the same names from index.ts and index.mobile.ts", () => {
    const web = named(read("lib/platform/index.ts"));
    const mobile = named(read("lib/platform/index.mobile.ts")).filter(
      // Mobile additionally exposes the translation helper for its own use.
      (name) => name !== "toMobilePath"
    );
    expect(mobile).toEqual(web);
  });
});

describe("the mobile bundle is wired to the mobile barrel", () => {
  it("vite aliases @/lib/platform before the general @ rule", () => {
    const config = read("mobile/vite.config.ts");
    const platformAt = config.indexOf("lib/platform/index.mobile.ts");
    const generalAt = config.search(/find:\s*"@"/);
    expect(platformAt).toBeGreaterThan(-1);
    expect(generalAt).toBeGreaterThan(-1);
    // Vite matches alias entries in order; the general rule would otherwise
    // swallow @/lib/platform and hand mobile the Next files.
    expect(platformAt).toBeLessThan(generalAt);
  });
});
