import { describe, expect, it } from "vitest";
import { bucketDailyCounts, bucketMax, bucketTotal, planMix } from "@/lib/admin/overview";

describe("bucketDailyCounts", () => {
  const now = new Date("2026-07-21T12:00:00.000Z");

  it("produces one bucket per day, inclusive of today, in order", () => {
    const buckets = bucketDailyCounts([], 7, now);
    expect(buckets).toHaveLength(7);
    expect(buckets[0].key).toBe("2026-07-15");
    expect(buckets[6].key).toBe("2026-07-21");
  });

  it("counts timestamps into their UTC day and ignores out-of-window ones", () => {
    const buckets = bucketDailyCounts(
      [
        "2026-07-21T01:00:00Z",
        "2026-07-21T23:00:00Z",
        "2026-07-20T10:00:00Z",
        "2026-07-01T10:00:00Z", // before window
        "not-a-date",
        null
      ],
      7,
      now
    );
    expect(buckets[6].count).toBe(2); // two on the 21st
    expect(buckets[5].count).toBe(1); // one on the 20th
    expect(bucketTotal(buckets)).toBe(3); // out-of-window + junk ignored
  });

  it("reports total and max", () => {
    const buckets = bucketDailyCounts(["2026-07-21T01:00:00Z", "2026-07-21T02:00:00Z", "2026-07-19T02:00:00Z"], 7, now);
    expect(bucketTotal(buckets)).toBe(3);
    expect(bucketMax(buckets)).toBe(2);
  });

  it("labels buckets in a human month-day form", () => {
    const buckets = bucketDailyCounts([], 3, now);
    expect(buckets[2].label).toBe("Jul 21");
  });
});

describe("planMix", () => {
  it("counts plans in tier order and includes zero tiers", () => {
    const mix = planMix(["buddy_plus", "buddy_pro", "buddy_plus", "free"]);
    expect(mix.map((row) => row.plan)).toEqual(["free", "buddy_plus", "buddy_pro"]);
    expect(mix.find((row) => row.plan === "buddy_plus")?.count).toBe(2);
    expect(mix.find((row) => row.plan === "buddy_pro")?.count).toBe(1);
    expect(mix.find((row) => row.plan === "free")?.count).toBe(1);
  });

  it("labels tiers", () => {
    expect(planMix(["buddy_pro"]).find((row) => row.plan === "buddy_pro")?.label).toBe("Buddy Pro");
  });
});
