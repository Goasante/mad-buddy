import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the single React type identity across the root and native projects.
 *
 * The native project maps `@/*` into the repository root, so it compiles root
 * components as well as its own. When both projects carry their own physical
 * copy of @types/react -- even at the SAME version -- TypeScript treats the two
 * as unrelated nominal types, and every shared component taking a ref fails
 * with "Two different types with this name exist, but they are unrelated".
 *
 * The fix is a path pin rather than a version bump: the versions already
 * matched. These tests pin the pin.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the native project resolves one React type identity", () => {
  const tsconfig = read("mobile/tsconfig.json");

  it("pins react types to the root copy", () => {
    expect(tsconfig).toContain('"react": ["../node_modules/@types/react"]');
  });

  it("pins react-dom and the jsx runtime to the same copy", () => {
    // The jsx-runtime carries its own JSX namespace; leaving it unpinned
    // reintroduces the split for every file using the automatic runtime.
    expect(tsconfig).toContain('"react-dom": ["../node_modules/@types/react-dom"]');
    expect(tsconfig).toContain('"react/jsx-runtime": ["../node_modules/@types/react/jsx-runtime"]');
  });

  it("keeps the root alias that makes the pin necessary", () => {
    // If `@/*` ever stops pointing at the root, these pins are inert rather
    // than wrong -- but the alias is what the native screens import through.
    expect(tsconfig).toContain('"@/*": ["../*"]');
  });

  it("uses a relative path, so it survives a clean install", () => {
    // A pin naming a hoisted location would break whenever the package manager
    // chose to nest instead.
    expect(tsconfig).not.toMatch(/"react":\s*\[\s*"[A-Za-z]:/);
    expect(tsconfig).toContain("../node_modules/@types/react");
  });
});

describe("both projects declare the same React types version", () => {
  const rootPackage = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const mobilePackage = JSON.parse(read("mobile/package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const typesVersion = (pkg: typeof rootPackage) =>
    pkg.devDependencies?.["@types/react"] ?? pkg.dependencies?.["@types/react"];

  it("agrees on the declared range", () => {
    // Matching versions are necessary but NOT sufficient -- the original defect
    // occurred with both at 19.2.17. The path pin above is what actually fixes
    // it; this test stops the two drifting apart on top of that.
    expect(typesVersion(mobilePackage)).toBe(typesVersion(rootPackage));
  });
});
