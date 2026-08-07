import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeFile,
  collectFriendshipQuerySites,
  unguardedFriendshipReads,
  HISTORICAL_ANNOTATION
} from "@/lib/life/friendship-query-guard";

/**
 * Guard tests, in two halves:
 *
 *  1. THE GUARD WORKS — on synthetic files with known answers, so a guard that
 *     silently stopped detecting anything cannot pass by scanning a clean tree.
 *  2. THE REPOSITORY IS CLEAN — the guard run against the real source.
 *
 * Without the first half the second is worthless: a broken matcher returns
 * zero findings and looks identical to success.
 */

const workspace = mkdtempSync(join(tmpdir(), "friendship-guard-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

let counter = 0;
/** Writes a source file into a fake tree and analyses it. */
function analyze(source: string) {
  const directory = join(workspace, `case-${(counter += 1)}`, "lib");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "query.ts");
  writeFileSync(file, source, "utf8");
  return analyzeFile(join(workspace, `case-${counter}`), file);
}

describe("friendship query guard — detection", () => {
  it("flags an active-friend read with no ended_at filter", () => {
    const sites = analyze(`
      const { data } = await admin
        .from("friendships")
        .select("user_one_id")
        .eq("user_one_id", userId);
    `);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.kind).toBe("read");
    expect(sites[0]!.hasEndedFilter).toBe(false);
    expect(unguardedFriendshipReads(sites)).toHaveLength(1);
  });

  it("accepts a read that filters on ended_at", () => {
    const sites = analyze(`
      const { data } = await admin
        .from("friendships")
        .select("user_one_id")
        .eq("user_one_id", userId)
        .is("ended_at", null);
    `);
    expect(sites[0]!.hasEndedFilter).toBe(true);
    expect(unguardedFriendshipReads(sites)).toHaveLength(0);
  });

  it("accepts an ended_at predicate composed inside .or()", () => {
    const sites = analyze(`
      await admin.from("friendships").select("id").or("ended_at.is.null");
    `);
    expect(sites[0]!.hasEndedFilter).toBe(true);
    expect(unguardedFriendshipReads(sites)).toHaveLength(0);
  });

  it("accepts an unfiltered read that declares itself historical", () => {
    const sites = analyze(`
      const { data } = await admin
        // ${HISTORICAL_ANNOTATION} replay needs ended friendships too.
        .from("friendships")
        .select("user_one_id, ended_at");
    `);
    expect(sites[0]!.annotatedHistorical).toBe(true);
    expect(unguardedFriendshipReads(sites)).toHaveLength(0);
  });

  it("ignores writes, which are not visibility decisions", () => {
    // An update that SETS ended_at must not filter on it being null.
    const sites = analyze(`
      await admin.from("friendships").update({ ended_at: now }).eq("id", id);
      await admin.from("friendships").delete().eq("id", id);
    `);
    expect(sites.every((site) => site.kind === "write")).toBe(true);
    expect(unguardedFriendshipReads(sites)).toHaveLength(0);
  });

  it("does not let one query's filter cover the next query", () => {
    // The bug a fixed-line-window scanner has: the filtered query below would
    // be read as part of the unfiltered one above it, hiding a real failure.
    const sites = analyze(`
      const a = await admin.from("friendships").select("id").eq("user_one_id", me);
      const b = await admin.from("friendships").select("id").is("ended_at", null);
    `);
    expect(sites).toHaveLength(2);
    expect(sites[0]!.hasEndedFilter).toBe(false);
    expect(sites[1]!.hasEndedFilter).toBe(true);
    expect(unguardedFriendshipReads(sites)).toHaveLength(1);
  });

  it("does not let a nearby annotation cover an unrelated later query", () => {
    const sites = analyze(`
      // ${HISTORICAL_ANNOTATION} this one really is historical.
      const a = await admin.from("friendships").select("id, ended_at");

      const filler1 = 1;
      const filler2 = 2;
      const filler3 = 3;
      const filler4 = 4;
      const filler5 = 5;
      const filler6 = 6;
      const filler7 = 7;
      const filler8 = 8;

      const b = await admin.from("friendships").select("id").eq("user_one_id", me);
    `);
    expect(sites[0]!.annotatedHistorical).toBe(true);
    expect(sites[1]!.annotatedHistorical).toBe(false);
    expect(unguardedFriendshipReads(sites)).toHaveLength(1);
  });
});

describe("friendship query guard — repository", () => {
  const sites = collectFriendshipQuerySites(process.cwd());

  it("finds the friendships call sites (the scanner is actually running)", () => {
    // If a refactor moves these queries behind a helper this number drops,
    // which is fine — but it must never silently reach zero, because a
    // zero-site scan would make every assertion below vacuous.
    expect(sites.length).toBeGreaterThan(20);
  });

  it("has no active-friend read missing an ended_at filter", () => {
    const unguarded = unguardedFriendshipReads(sites);
    expect(
      unguarded.map((site) => `${site.file}:${site.line}`),
      "Each of these reads treats an ENDED friendship as active. Add .is(\"ended_at\", null), " +
        `or annotate the query with ${HISTORICAL_ANNOTATION} if it deliberately wants ended rows.`
    ).toEqual([]);
  });

  it("keeps historical annotations rare and deliberate", () => {
    // The annotation is an escape hatch. If it spreads, the guard stops
    // guarding anything, so its use is bounded and reviewed.
    const historical = sites.filter((site) => site.kind === "read" && site.annotatedHistorical);
    expect(historical.length).toBeLessThanOrEqual(10);
  });
});
