import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { upForPhase } from "@/lib/social/upfor-lifecycle";

const projection = readFileSync(
  join(__dirname, "home-projection.ts"),
  "utf8"
);
const upForReader = readFileSync(
  join(__dirname, "..", "social", "home-upfor-context.ts"),
  "utf8"
);

describe("Home Smart Card lifecycle freshness", () => {
  it("never treats a closed or historical Plan Chat as live coordination", () => {
    const start = projection.indexOf("export async function loadPlanChatDecisions");
    const end = projection.indexOf("/**\n * A feature the viewer switched ON", start);
    const reader = projection.slice(start, end);

    expect(reader).toContain("if (planTitleById.size === 0) return [];");
    expect(reader).toContain('.eq("status", "active")');
    expect(reader).toContain('.in("context_id", currentPlanIds)');
    expect(reader).not.toContain('.neq("status", "deleted")');
    expect(reader).toContain('.order("created_at", { ascending: false })');
    expect(reader).toContain("if (!planId || !planTitle) continue;");
  });

  it("treats an active-status UpFor with a past end time as terminal", () => {
    const now = Date.parse("2026-09-23T08:00:00.000Z");
    expect(
      upForPhase(
        {
          status: "active",
          startsAt: "2026-09-22T17:00:00.000Z",
          endsAt: "2026-09-22T19:00:00.000Z"
        },
        now
      )
    ).toBe("terminal");
  });

  it("makes both owned and joined Home UpFor projections use the clock-aware lifecycle", () => {
    const phaseCalls = upForReader.match(/upForPhase\(/g) ?? [];
    expect(phaseCalls.length).toBeGreaterThanOrEqual(2);
    expect(upForReader).not.toContain(
      "const ownedLive = owned.filter((session) => !scheduledIds.has(session.id));"
    );
    expect(upForReader).toContain("const liveSessions = (sessions ?? []).filter");
    expect(upForReader).toContain("const sessionById = new Map(liveSessions.map");
  });
});
