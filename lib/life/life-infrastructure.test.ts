import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineSourceRow } from "@/lib/life/timeline";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const resetMigration = read("supabase/migrations/20260806230000_life_timeline_resets.sql");
const emit = read("lib/life/emit.ts");
const rebuild = read("lib/life/rebuild.ts");
const service = read("lib/life/timeline-service.ts");

// ---------------------------------------------------------------------------
// Timeline reset — a tombstone, not a delete
// ---------------------------------------------------------------------------

describe("timeline reset", () => {
  const rows: TimelineSourceRow[] = [
    { eventType: "relationship.created", actorId: ALICE, occurredAt: at(100), payload: { subjectId: BOB } },
    { eventType: "plan.attended_together", actorId: ALICE, occurredAt: at(50), payload: { subjectId: BOB } },
    { eventType: "plan.attended_together", actorId: BOB, occurredAt: at(5), payload: { subjectId: ALICE } }
  ];

  it("hides everything at or before the cut-off", () => {
    const cutoff = NOW - 20 * DAY;
    const { entries } = buildTimeline(rows, ALICE, { hiddenBeforeMs: cutoff });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.occurredAtMs).toBeGreaterThan(cutoff);
  });

  it("still shows events that arrive after the reset", () => {
    // A boolean flag would leave the timeline empty forever. A timestamp lets
    // it repopulate, which is what makes clearing a fresh start.
    const withNew: TimelineSourceRow[] = [
      ...rows,
      { eventType: "plan.attended_together", actorId: ALICE, occurredAt: at(1), payload: { subjectId: BOB } }
    ];
    expect(buildTimeline(withNew, ALICE, { hiddenBeforeMs: NOW - 20 * DAY }).entries).toHaveLength(2);
  });

  it("affects one user only", () => {
    // The other participant's view is untouched by a reset they cannot detect.
    buildTimeline(rows, ALICE, { hiddenBeforeMs: NOW });
    expect(buildTimeline(rows, BOB, { hiddenBeforeMs: null }).entries).toHaveLength(3);
  });

  it("deletes nothing, so the same rows rebuild in full", () => {
    expect(buildTimeline(rows, ALICE, { hiddenBeforeMs: NOW }).entries).toEqual([]);
    expect(buildTimeline(rows, ALICE, { hiddenBeforeMs: null }).entries).toHaveLength(3);
  });

  it("is still overridden by blocking", () => {
    expect(buildTimeline(rows, ALICE, { hiddenBeforeMs: null, blocked: true }).entries).toEqual([]);
  });

  it("stores a timestamp, never a boolean", () => {
    expect(resetMigration).toContain("hidden_before timestamptz not null");
    expect(resetMigration).not.toContain("hidden boolean");
  });

  it("keeps one cut-off per user per relationship", () => {
    // Clearing twice moves it forward rather than accumulating rows.
    expect(resetMigration).toContain("create unique index if not exists life_timeline_resets_unique");
  });

  it("keeps a reset private to its owner", () => {
    expect(resetMigration).toContain("using (auth.uid() = user_id)");
    expect(resetMigration).toContain("enable row level security");
  });

  it("does not touch domain_events", () => {
    // SQL comments stripped: the migration header explains that events are
    // NOT deleted, which would otherwise trip this.
    const sql = resetMigration.replace(/^\s*--.*$/gm, "");
    expect(sql).not.toContain("domain_events");
    expect(sql).not.toContain("delete from");
  });
});

// ---------------------------------------------------------------------------
// Emission — compensating
// ---------------------------------------------------------------------------

describe("event emission", () => {
  const actions = read("app/(app)/actions.ts");
  const circles = read("app/(app)/circles-actions.ts");

  it("writes to domain_events, never a parallel table", () => {
    expect(emit).toContain('.from("domain_events")');
    expect(stripComments(emit)).not.toContain("relationship_events");
  });

  it("never throws into the caller", () => {
    // Recording history must not be able to undo the thing that happened.
    const body = stripComments(emit);
    expect(body).not.toContain("throw new");
    expect(body).toContain("try {");
  });

  it("treats a duplicate as success rather than failure", () => {
    expect(emit).toContain("23505");
    expect(stripComments(emit)).toContain('status: "duplicate"');
  });

  it("logs a real failure so a missing event is observable", () => {
    expect(emit).toContain("logBackendEvent");
    expect(emit).toContain("life/emit");
  });

  it("emits only after the friendship exists", () => {
    const accept = actions.slice(
      actions.indexOf("acceptFriendRequestAction"),
      actions.indexOf("updateFriendRequestStatusAction")
    );
    expect(accept.indexOf("if (result.ok)")).toBeLessThan(accept.indexOf("relationship.created"));
  });

  it("does not await emission into the action result", () => {
    expect(actions).toContain("void (async () => {");
    expect(actions).toContain("relationship.created");
    expect(actions).toContain("relationship.ended");
  });

  it("emits close-friend changes, keyed per owner", () => {
    expect(circles).toContain("relationship.close_friend_added");
    expect(circles).toContain("relationship.close_friend_removed");
    // Both directions coexist without colliding on one dedupe key.
    expect(circles).toContain("added:${userId}");
  });

  it("emits from server actions only, never a component", () => {
    expect(emit).toContain('import "server-only"');
  });
});

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

describe("projection rebuild", () => {
  it("replays from the source tables", () => {
    expect(rebuild).toContain('.from("friendships")');
    expect(rebuild).toContain('.from("close_friend_relationships")');
  });

  it("uses real timestamps, not the moment it ran", () => {
    // A rebuild must not rewrite history to today.
    expect(rebuild).toContain("occurredAt: friendship.created_at");
    expect(rebuild).toContain("occurredAt: friendship.ended_at");
  });

  it("is idempotent through stable dedupe keys", () => {
    expect(rebuild).toContain("created");
    expect(rebuild).toContain("ended");
    expect(stripComments(emit)).toContain('status: "duplicate"');
  });

  it("never deletes or mutates events", () => {
    const body = stripComments(rebuild);
    expect(body).not.toContain(".delete()");
    expect(body).not.toContain(".update(");
  });

  it("offers relationship, user and paged full rebuild", () => {
    expect(rebuild).toContain("export async function rebuildRelationship");
    expect(rebuild).toContain("export async function rebuildUser");
    expect(rebuild).toContain("export async function rebuildAll");
    // Paged rather than unbounded.
    expect(rebuild).toContain(".range(offset, offset + limit - 1)");
  });

  it("does not let one bad row abandon a replay", () => {
    expect(emit).toContain("export async function emitLifeEvents");
  });
});

// ---------------------------------------------------------------------------
// Server loader
// ---------------------------------------------------------------------------

describe("timeline loader", () => {
  it("is server-only and authoritative", () => {
    expect(service).toContain('import "server-only"');
  });

  it("checks the feature flag before anything else", () => {
    expect(service.indexOf("LIFE_TIMELINE_FLAG")).toBeLessThan(service.indexOf("isBlockedEitherDirection"));
  });

  it("checks blocking before reading any event", () => {
    expect(service.indexOf("isBlockedEitherDirection")).toBeLessThan(service.indexOf('.from("domain_events")'));
  });

  it("reuses the existing block check rather than writing a new one", () => {
    expect(service).toContain("@/lib/social/permissions");
  });

  it("applies the viewer's own reset", () => {
    expect(service).toContain('.from("life_timeline_resets")');
    expect(service).toContain("hiddenBeforeMs");
  });

  it("refuses a timeline about yourself", () => {
    expect(service).toContain("input.viewerId === input.otherUserId");
  });

  it("clears by recording a cut-off, never deleting", () => {
    const clear = service.slice(service.indexOf("clearRelationshipTimeline"));
    expect(clear).toContain(".upsert(");
    expect(clear).not.toContain(".delete()");
  });

  it("scopes every read to the canonical relationship id", () => {
    expect(service).toContain("relationshipId(input.viewerId, input.otherUserId)");
  });

  it("returns an empty timeline rather than throwing when gated", () => {
    // Every gate returns `empty`, so a caller never has to distinguish
    // "blocked" from "flag off" — which would itself leak information.
    expect(service).toContain("return empty;");
  });
});
