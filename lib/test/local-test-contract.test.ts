import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The DB-backed test contract, guarded against drift.
 *
 * Six `*.local.test.ts` suites share ONE local Supabase instance, the same
 * canonical fixtures (USERS.A-D, CONVERSATIONS.direct/group, EVENT_ID) and an
 * acting identity that lives on globalThis. Running them in the ordinary
 * parallel unit workers is therefore a correctness problem, not a slow one.
 *
 * Two failures this configuration exists to prevent, both already paid for:
 *   - media authorization suites failing in parallel while passing alone;
 *   - lib/linkr/live-journey skipping all 17 of its tests silently because it
 *     never loaded .env.local, so its isLocal guard saw an empty URL and the
 *     run still reported green.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const unitConfig = read("vitest.config.ts");
const localConfig = read("vitest.local.config.ts");

describe("the two suites stay separated", () => {
  it("the unit config excludes DB-backed suites", () => {
    expect(unitConfig).toMatch(/exclude:[\s\S]*?lib\/\*\*\/\*\.local\.test\.ts/);
  });

  it("the local config includes only DB-backed suites", () => {
    expect(localConfig).toMatch(/include:\s*\["lib\/\*\*\/\*\.local\.test\.ts"\]/);
  });
});

describe("DB-backed suites are serial by construction", () => {
  it("runs them in a single fork", () => {
    expect(localConfig).toMatch(/pool:\s*"forks"/);
    expect(localConfig).toMatch(/singleFork:\s*true/);
  });

  it("disables file parallelism", () => {
    expect(localConfig).toMatch(/fileParallelism:\s*false/);
  });

  it("disables concurrent tests within a file", () => {
    expect(localConfig).toMatch(/sequence:\s*\{\s*concurrent:\s*false\s*\}/);
  });

  it("loads the shared guard so no suite can skip silently", () => {
    expect(localConfig).toMatch(/setupFiles:\s*\["lib\/test\/local-db-setup\.ts"\]/);
  });
});

describe("unit tests keep their parallelism", () => {
  it("the unit config sets no single-fork or serial option", () => {
    // 7,900+ tests must not pay for six.
    expect(unitConfig).not.toMatch(/singleFork/);
    expect(unitConfig).not.toMatch(/fileParallelism:\s*false/);
  });
});

describe("the commands a release operator uses", () => {
  it("test runs the unit suite", () => {
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("test:local targets the local config", () => {
    expect(pkg.scripts["test:local"]).toMatch(/vitest run --config vitest\.local\.config\.ts/);
  });

  it("test:release runs BOTH", () => {
    // A release must never be signed off on the unit suite alone.
    expect(pkg.scripts["test:release"]).toMatch(/test/);
    expect(pkg.scripts["test:release"]).toMatch(/test:local/);
  });

  it("the canonical seed has its own command", () => {
    expect(pkg.scripts["seed:local-tests"]).toMatch(/seed-local-tests\.mjs/);
  });
});

describe("the local guard refuses rather than skips", () => {
  const setup = read("lib/test/local-db-setup.ts");

  it("throws when .env.local is missing", () => {
    expect(setup).toMatch(/throw new Error\([\s\S]*?\.env\.local/);
  });

  it("throws when the target is not local", () => {
    expect(setup).toMatch(/refuse to run against a non-local target/);
  });

  it("refuses a resolved production or staging reference", () => {
    expect(setup).toMatch(/cabkhxxnrybzhkbtoiiz/);
    expect(setup).toMatch(/ivaydmciwmjdjsrovbqb/);
  });

  it("never prints the service-role key", () => {
    expect(setup).not.toMatch(/console\.log\([^)]*serviceRole/);
  });
});
