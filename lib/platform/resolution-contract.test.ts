import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * THE RESOLUTION CONTRACT.
 *
 * Three tools resolve "@/lib/platform", and they must agree:
 *
 *   - TypeScript (mobile) -> index.mobile.ts
 *   - Vite (mobile bundle) -> index.mobile.ts
 *   - Next (web build)     -> index.ts
 *
 * This is not hypothetical. A Vite `resolve.alias` is invisible to TypeScript,
 * so before mobile/tsconfig.json gained a matching `paths` entry, "@/*" fell
 * through to "../*" and TypeScript resolved the WEB barrel while Vite bundled
 * the MOBILE one -- the types being checked and the code being shipped were
 * different files. Every mobile-only signature gap would have typechecked
 * clean and failed on a device.
 *
 * A future "tidy-up" of either config would silently reintroduce that, so the
 * agreement is asserted here rather than left to comments.
 */

const read = (path: string) => readFileSync(path, "utf8");

describe("TypeScript resolves the mobile barrel for the mobile project", () => {
  it("mobile/tsconfig.json maps @/lib/platform to index.mobile.ts", () => {
    const config = read("mobile/tsconfig.json");
    expect(config).toMatch(
      /"@\/lib\/platform"\s*:\s*\[\s*"\.\.\/lib\/platform\/index\.mobile\.ts"\s*\]/
    );
  });

  it("proves it against the real compiler, not just the config text", () => {
    // --listFiles reports the actual program. This is the assertion that would
    // have caught the original bug: the config can look right and still lose
    // to a more specific rule or a stale mapping.
    // Invoked through Node rather than the npx shim: Windows refuses to
    // spawnSync a .cmd directly (EINVAL), and this is portable besides.
    const output = execFileSync(
      process.execPath,
      [require.resolve("typescript/bin/tsc"), "--noEmit", "--listFiles"],
      { cwd: "mobile", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const barrels = output
      .split(/\r?\n/)
      .filter((line) => /lib[\\/]platform[\\/]index(\.mobile)?\.ts$/.test(line.trim()));

    expect(barrels.length).toBeGreaterThan(0);
    // The mobile program must contain the mobile barrel and NOT the web one.
    expect(barrels.some((line) => line.includes("index.mobile.ts"))).toBe(true);
    expect(barrels.some((line) => /index\.ts$/.test(line.trim()))).toBe(false);
  }, 180_000);
});

describe("Vite resolves the mobile barrel for the mobile bundle", () => {
  const config = read("mobile/vite.config.ts");

  it("aliases @/lib/platform to index.mobile.ts", () => {
    expect(config).toMatch(/lib\/platform\/index\.mobile\.ts/);
  });

  it("matches the platform alias BEFORE the general @ rule", () => {
    // Vite evaluates alias entries in order; the general rule would otherwise
    // swallow @/lib/platform and hand mobile the Next files.
    const platformAt = config.indexOf("lib/platform/index.mobile.ts");
    const generalAt = config.search(/find:\s*"@"/);
    expect(platformAt).toBeGreaterThan(-1);
    expect(generalAt).toBeGreaterThan(-1);
    expect(platformAt).toBeLessThan(generalAt);
  });
});

describe("the web build keeps the web barrel", () => {
  it("the root tsconfig does not redirect @/lib/platform", () => {
    // Web must resolve @/* -> ./* normally, reaching index.ts. A paths entry
    // here would point the web app at react-router.
    const config = read("tsconfig.json");
    expect(config).not.toMatch(/"@\/lib\/platform"/);
  });

  it("the root tsconfig excludes the mobile implementations", () => {
    // They import react-router-dom, a mobile-only dependency; compiling them
    // in the web project fails outright.
    const config = read("tsconfig.json");
    expect(config).toContain("lib/platform/*.mobile.ts");
    expect(config).toContain("lib/platform/*.mobile.tsx");
  });

  it("the web barrel re-exports Next, so web behaviour is unchanged", () => {
    const barrel = read("lib/platform/index.ts");
    expect(barrel).toContain('from "./link"');
    expect(read("lib/platform/link.tsx")).toContain('from "next/link"');
  });
});
