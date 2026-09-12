import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The bundle checker's own marker list.
 *
 * WHY THIS FILE EXISTS. scripts/verify-mobile-bundle.mjs reported "clean"
 * while `_next/image`, `NEXT_DEPLOYMENT_ID` and `imageConfigDefault` were all
 * present in a shipped APK. The markers it watched for (`__next_app__`,
 * `next/dist/client`) were genuinely absent, because next/image bundles its
 * own runtime without dragging in the App Router. The gate passed; the leak
 * shipped.
 *
 * A checker that cannot fail is worse than no checker, because it is trusted.
 * These assertions pin the markers that have actually been observed leaking,
 * so a later "tidy-up" of that list cannot quietly reopen the hole.
 *
 * This does NOT replace running the checker against a real build -- that is a
 * CI step. It guards the list the checker uses.
 */

const checker = readFileSync("scripts/verify-mobile-bundle.mjs", "utf8");

describe("markers confirmed to have leaked into a real APK", () => {
  it.each([
    ["_next\\/image", "the next/image optimizer endpoint"],
    ["NEXT_DEPLOYMENT_ID", "the next/image deployment-id hook"],
    ["imageConfigDefault", "next/image's default image config"]
  ])("watches for %s", (pattern) => {
    expect(checker).toContain(pattern);
  });
});

describe("the original App Router / RSC markers are still watched", () => {
  it.each(["__next_app__", "next\\/dist\\/client", "createServerReference", "react-server-dom-webpack"])(
    "watches for %s",
    (pattern) => {
      expect(checker).toContain(pattern);
    }
  );
});

describe("server-only credentials stay watched", () => {
  it.each(["SUPABASE_SERVICE_ROLE_KEY", "createSupabaseAdminClient"])("watches for %s", (pattern) => {
    expect(checker).toContain(pattern);
  });
});

describe("the checker fails rather than warns", () => {
  it("exits non-zero on a violation, so CI can gate on it", () => {
    expect(checker).toContain("process.exit(1)");
  });

  it("fails when the bundle is missing rather than reporting clean", () => {
    // "No files checked" must not read as success -- that would pass on a
    // build that never ran.
    expect(checker).toContain("checked === 0");
  });
});

describe("shared components reach next/image only through the adapter", () => {
  // The actual leak: two components rendered by the shared chrome imported
  // next/image directly.
  it.each([
    "components/brand/brand-mark.tsx",
    "components/brand/brand-navigation-icon.tsx",
    "components/app-shell/app-header.tsx",
    "components/app-shell/mobile-nav.tsx"
  ])("%s does not import next/* directly", (path) => {
    const source = readFileSync(path, "utf8");
    const imports = source
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");
    expect(imports).not.toMatch(/from\s+["']next\//);
  });
});
