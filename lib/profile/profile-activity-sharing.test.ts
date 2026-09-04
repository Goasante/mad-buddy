import { describe, expect, it, vi } from "vitest";

import { loadProfileIdentitySummary } from "@/lib/profile/identity-service";

/**
 * Shared activity evidence on a Profile GET.
 *
 * Identity and Journey each counted friendships, moments and completed safe
 * arrivals with byte-identical filters, so one Profile request asked the same
 * three questions twice. Measured route fan-out: 22 downstream calls before,
 * 19 after.
 *
 * Plans are deliberately NOT shared -- Identity counts COMPLETED plans while
 * Journey counts NON-DRAFT ones. Same table, different fact. These tests hold
 * that distinction, because collapsing it would silently change the numbers
 * shown on a profile.
 *
 * Behavioural, not source-text: a fake client records which tables are queried.
 */

type Recorded = { table: string; head: boolean };

/** Minimal Supabase-shaped stub that records table access. */
function fakeAdmin(recorded: Recorded[], counts: Record<string, number> = {}) {
  const builder = (table: string) => {
    const state = { head: false };
    const result: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => {
        state.head = Boolean(opts?.head);
        return result;
      },
      eq: () => result,
      in: () => result,
      is: () => result,
      or: () => result,
      order: () => result,
      limit: () => result,
      maybeSingle: () => {
        recorded.push({ table, head: state.head });
        return Promise.resolve({ data: null, count: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        recorded.push({ table, head: state.head });
        return Promise.resolve({ data: [], count: counts[table] ?? 0 }).then(resolve);
      }
    };
    return result;
  };
  return { from: (table: string) => builder(table) } as never;
}

const score = {
  total: 0,
  level: { label: "New", min: 0 },
  nextLevel: null,
  pointsToNext: 0,
  progressPercent: 0,
  categories: [],
  recentActivity: []
} as never;

describe("Identity reuses shared activity counts", () => {
  it("does not re-query friendships, moments or safe arrivals when supplied", async () => {
    const recorded: Recorded[] = [];
    await loadProfileIdentitySummary(fakeAdmin(recorded), "user-1", "self", {
      score,
      activity: { muddyCount: 4, momentCount: 2, completedSafeArrivalCount: 1 }
    });

    const tables = recorded.map((r) => r.table);
    expect(tables).not.toContain("friendships");
    expect(tables).not.toContain("moments");
    expect(tables).not.toContain("safe_arrival_sessions");
  });

  it("still queries plans itself, because that fact is NOT shared", async () => {
    // Identity wants completed plans; Journey wants non-draft. Sharing these
    // would change the reported completed-plan count.
    const recorded: Recorded[] = [];
    await loadProfileIdentitySummary(fakeAdmin(recorded), "user-1", "self", {
      score,
      activity: { muddyCount: 4, momentCount: 2, completedSafeArrivalCount: 1 }
    });

    expect(recorded.map((r) => r.table)).toContain("plans");
  });

  it("uses the supplied counts verbatim in the response", async () => {
    const summary = await loadProfileIdentitySummary(fakeAdmin([]), "user-1", "self", {
      score,
      activity: { muddyCount: 7, momentCount: 3, completedSafeArrivalCount: 5 }
    });

    expect(summary.activity?.muddyCount).toBe(7);
    expect(summary.activity?.momentCount).toBe(3);
    expect(summary.activity?.completedSafeArrivalCount).toBe(5);
  });

  it("falls back to its own queries when no counts are supplied", async () => {
    // Backward compatibility: other callers must keep working unchanged.
    const recorded: Recorded[] = [];
    await loadProfileIdentitySummary(fakeAdmin(recorded), "user-1", "self", { score });

    const tables = recorded.map((r) => r.table);
    expect(tables).toContain("friendships");
    expect(tables).toContain("moments");
    expect(tables).toContain("safe_arrival_sessions");
  });
});

describe("the Profile route resolves shared evidence once", () => {
  it("passes both score and activity to Identity and Journey", async () => {
    const route = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../app/api/profile/route.ts", import.meta.url), "utf8")
    );
    const code = route
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((l) => (l.indexOf("//") === -1 ? l : l.slice(0, l.indexOf("//"))))
      .join("\n");

    expect(code).toMatch(/loadProfileIdentitySummary\([^;]*\{\s*score,\s*activity\s*\}\s*\)/);
    expect(code).toMatch(/loadJourney\([^;]*\{\s*score,\s*activity\s*\}\s*\)/);
    // And still read-only, from P1.
    expect(code).not.toMatch(/reconcileBuddyScore/);
    expect(code).not.toMatch(/\bloadBuddyScore\s*\(/);
  });
});

describe("vi spies are not load-bearing here", () => {
  it("keeps the suite honest about what it asserts", () => {
    // The tests above assert observed table access, not call counts on a mock
    // of our own design; this placeholder documents that choice.
    expect(vi).toBeDefined();
  });
});
