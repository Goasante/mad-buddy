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
    expect(reader).toContain('.from("messages")');
    expect(reader).toContain('"id, status, deleted_at, expires_at, kept_at"');
    expect(reader).toContain("liveParentIds");
    expect(reader).toContain("message.kept_at || !message.expires_at");
    expect(reader).toContain("if (!planId || !planTitle || !planEndsAt) continue;");
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
    expect(upForReader).toContain('.in("status", ["active", "full"])');
    expect(upForReader).toContain('status: session.status ?? "active"');
  });

  it("fails closed when vote evidence cannot prove a decision is unanswered", () => {
    expect(projection).toContain("const { data: votes, error: votesError }");
    const voteErrors = projection.match(/if \(votesError\) return \[\];/g) ?? [];
    expect(voteErrors.length).toBeGreaterThanOrEqual(2);
  });

  it("does not resurrect a declined or cancelled UpFor as a fresh Home opportunity", () => {
    expect(upForReader).toContain('.from("hangout_requests")');
    expect(upForReader).toContain('"hangout_session_id"');
    expect(upForReader).toContain('.eq("requester_id", viewerId)');
    expect(upForReader).toContain("actedOnSessionIds");
    expect(upForReader).toContain(
      "candidates = candidates.filter((session) => !actedOnSessionIds.has(session.id))"
    );
  });
});
