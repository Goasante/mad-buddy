import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Life relationship resource keys", () => {
  const migration = read("supabase/migrations/20260923223646_repair_life_event_relationship_keys.sql");
  const emitter = read("lib/life/emit.ts");
  const milestones = read("lib/life/milestone-service.ts");
  const timeline = read("lib/life/timeline-service.ts");

  it("stores canonical relationship pairs in text rather than the UUID column", () => {
    expect(migration).toContain("add column if not exists resource_key text");
    expect(emitter).toContain("resource_id: null");
    expect(emitter).toContain("resource_key: record.resourceKey");
  });

  it("reads milestone and timeline evidence through the same key", () => {
    expect(milestones).toContain('.in("resource_key", ids)');
    expect(timeline).toContain('.eq("resource_key", relationship)');
    expect(milestones).not.toContain('.in("resource_id", ids)');
  });
});
