import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260724170000_open_moments_feature.sql"),
  "utf8"
);

describe("Open Moments migration", () => {
  it("ships disabled by default", () => {
    expect(sql).toMatch(/'open_moments'[\s\S]*?'off'[\s\S]*?false/);
  });

  it("adds a public audience without changing existing rows", () => {
    expect(sql).toMatch(/audience_type in[\s\S]*?'public'/);
    expect(sql).not.toMatch(/update\s+public\.moments\s+set\s+audience_type/i);
  });

  it("enforces the flag and entitlement at the RLS write boundary", () => {
    expect(sql).toContain("public.can_publish_open_moments(auth.uid())");
    expect(sql).toMatch(/create policy "moments author insert"[\s\S]*?with check/i);
    expect(sql).toMatch(/create policy "members read active public moments"[\s\S]*?f\.status = 'on'/i);
  });

  it("does not introduce location or movement storage", () => {
    expect(sql).not.toMatch(
      /\b(latitude|longitude|geohash|distance_meters)\s+(double precision|numeric|real|integer|text)/i
    );
  });
});
