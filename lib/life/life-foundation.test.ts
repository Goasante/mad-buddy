import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIFE_EVENT_CLASSIFICATION,
  LIFE_EVENT_TYPES,
  LIFE_RESOURCE_TYPE,
  buildLifeEvent,
  canViewLifeEvent,
  isLifeEventType,
  lifeDedupeKey,
  relationshipId
} from "@/lib/life/events";
import {
  RECONNECT_COOLDOWN_MS,
  RECONNECT_DISMISSAL_MS,
  RECONNECT_FORBIDDEN_WORDS,
  RECONNECT_MIN_INTERACTIONS,
  RECONNECT_QUIET_PERIOD_MS,
  evaluateReconnect,
  reconnectSuggestionCopy,
  type ReconnectFacts
} from "@/lib/life/reconnect";
import { MILESTONE_FORBIDDEN_WORDS, milestoneDedupeKey, milestonesFor } from "@/lib/life/milestones";
import { buildTimeline, timelineFacts, type TimelineSourceRow } from "@/lib/life/timeline";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

// ---------------------------------------------------------------------------
// Event contract
// ---------------------------------------------------------------------------

describe("event contract", () => {
  it("builds on the existing domain_events stream", () => {
    // One append-only table, not a parallel relationship stream.
    expect(LIFE_RESOURCE_TYPE).toBe("relationship");
    const source = stripComments(read("lib/life/events.ts"));
    expect(source).not.toContain("relationship_events");
    expect(source).not.toContain("create table");
  });

  it("gives a pair one id whichever way round it is asked", () => {
    // Without this the same fact could be recorded twice, once per side.
    expect(relationshipId(ALICE, BOB)).toBe(relationshipId(BOB, ALICE));
  });

  it("produces a stable dedupe key for the same fact", () => {
    const first = buildLifeEvent({
      eventType: "plan.attended_together",
      actorId: ALICE,
      subjectId: BOB,
      naturalKey: "plan-1"
    });
    const retry = buildLifeEvent({
      eventType: "plan.attended_together",
      actorId: BOB,
      subjectId: ALICE,
      naturalKey: "plan-1"
    });
    // Same fact from either side collapses to one row.
    expect(retry.dedupeKey).toBe(first.dedupeKey);
    expect(first.dedupeKey).toBe(
      lifeDedupeKey("plan.attended_together", relationshipId(ALICE, BOB), "plan-1")
    );
  });

  it("distinguishes different facts", () => {
    const a = buildLifeEvent({ eventType: "plan.attended_together", actorId: ALICE, subjectId: BOB, naturalKey: "p1" });
    const b = buildLifeEvent({ eventType: "plan.attended_together", actorId: ALICE, subjectId: BOB, naturalKey: "p2" });
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it("excludes moment.viewed deliberately", () => {
    // Per-view events would dwarf every other type and answer nothing.
    expect(LIFE_EVENT_TYPES as readonly string[]).not.toContain("moment.viewed");
    expect(isLifeEventType("moment.viewed")).toBe(false);
  });

  it("records no inferred relationship health", () => {
    for (const type of LIFE_EVENT_TYPES) {
      for (const banned of ["health", "score", "strength", "drift", "quality"]) {
        expect(type, `${type} looks like an inference`).not.toContain(banned);
      }
    }
  });

  it("refuses message content in a payload", () => {
    // Loud failure, not silent stripping: a caller doing this has a bug.
    for (const key of ["message", "text", "body", "content", "note"]) {
      expect(() =>
        buildLifeEvent({
          eventType: "plan.attended_together",
          actorId: ALICE,
          subjectId: BOB,
          naturalKey: "p1",
          payload: { [key]: "hello" }
        })
      , key).toThrow();
    }
  });

  it("refuses location and contact details too", () => {
    for (const key of ["latitude", "longitude", "email", "phone"]) {
      expect(() =>
        buildLifeEvent({
          eventType: "plan.attended_together",
          actorId: ALICE,
          subjectId: BOB,
          naturalKey: "p1",
          payload: { [key]: "x" }
        })
      , key).toThrow();
    }
  });

  it("classifies every event type, with AI off by default", () => {
    for (const type of LIFE_EVENT_TYPES) {
      const classification = LIFE_EVENT_CLASSIFICATION[type];
      expect(classification, type).toBeDefined();
      expect(classification.aiEligible, `${type} must not be AI-readable yet`).toBe(false);
    }
  });

  it("keeps a private judgement about someone away from them", () => {
    // Being added as a Close Friend is the owner's decision about the other
    // person; telling them would leak it.
    expect(LIFE_EVENT_CLASSIFICATION["relationship.close_friend_added"].visibility).toBe("private");
    expect(LIFE_EVENT_CLASSIFICATION["relationship.note_created"].visibility).toBe("private");
  });

  it("lets both parties see what they both did", () => {
    expect(LIFE_EVENT_CLASSIFICATION["plan.attended_together"].visibility).toBe("shared");
    expect(LIFE_EVENT_CLASSIFICATION["relationship.created"].visibility).toBe("shared");
  });
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe("event visibility", () => {
  const shared = buildLifeEvent({
    eventType: "plan.attended_together",
    actorId: ALICE,
    subjectId: BOB,
    naturalKey: "p1"
  });
  const priv = buildLifeEvent({
    eventType: "relationship.close_friend_added",
    actorId: ALICE,
    subjectId: BOB,
    naturalKey: "cf"
  });

  it("shows a shared event to both participants", () => {
    expect(canViewLifeEvent(shared, ALICE)).toBe(true);
    expect(canViewLifeEvent(shared, BOB)).toBe(true);
  });

  it("shows a private event only to its owner", () => {
    expect(canViewLifeEvent(priv, ALICE)).toBe(true);
    expect(canViewLifeEvent(priv, BOB)).toBe(false);
  });

  it("shows nothing to an outsider", () => {
    const outsider = "33333333-3333-4333-8333-333333333333";
    expect(canViewLifeEvent(shared, outsider)).toBe(false);
    expect(canViewLifeEvent(priv, outsider)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

describe("timeline projection", () => {
  const rows: TimelineSourceRow[] = [
    { eventType: "relationship.created", actorId: ALICE, occurredAt: at(400), payload: { subjectId: BOB } },
    { eventType: "plan.attended_together", actorId: ALICE, occurredAt: at(100), payload: { subjectId: BOB } },
    { eventType: "relationship.close_friend_added", actorId: ALICE, occurredAt: at(50), payload: { subjectId: BOB } },
    { eventType: "plan.attended_together", actorId: BOB, occurredAt: at(10), payload: { subjectId: ALICE } }
  ];

  it("returns newest first", () => {
    const { entries } = buildTimeline(rows, ALICE);
    const times = entries.map((entry) => entry.occurredAtMs);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("hides the other person's private events", () => {
    const forBob = buildTimeline(rows, BOB).entries.map((entry) => entry.eventType);
    expect(forBob).not.toContain("relationship.close_friend_added");
    // But shared history is still there.
    expect(forBob).toContain("plan.attended_together");
  });

  it("marks who acted", () => {
    const { entries } = buildTimeline(rows, ALICE);
    const own = entries.find((entry) => entry.eventType === "relationship.close_friend_added");
    expect(own?.byViewer).toBe(true);
  });

  it("returns nothing at all when blocked, in either direction", () => {
    // Absent, not filtered: a partial timeline still reveals the person acted.
    expect(buildTimeline(rows, ALICE, { blocked: true }).entries).toEqual([]);
    expect(buildTimeline(rows, BOB, { blocked: true }).entries).toEqual([]);
  });

  it("survives unfriending", () => {
    const ended: TimelineSourceRow[] = [
      ...rows,
      { eventType: "relationship.ended", actorId: ALICE, occurredAt: at(5), payload: { subjectId: BOB } }
    ];
    const { entries } = buildTimeline(ended, ALICE);
    // History is kept; the ending is simply another fact in it.
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.map((entry) => entry.eventType)).toContain("relationship.ended");
  });

  it("ignores unknown event types rather than rendering them", () => {
    const withJunk: TimelineSourceRow[] = [
      ...rows,
      { eventType: "moment.viewed", actorId: ALICE, occurredAt: at(1), payload: { subjectId: BOB } }
    ];
    expect(buildTimeline(withJunk, ALICE).entries.map((e) => e.eventType)).not.toContain("moment.viewed");
  });

  it("drops unparseable timestamps instead of dating them to the epoch", () => {
    const broken: TimelineSourceRow[] = [
      { eventType: "plan.attended_together", actorId: ALICE, occurredAt: "not-a-date", payload: { subjectId: BOB } }
    ];
    expect(buildTimeline(broken, ALICE).entries).toEqual([]);
  });

  it("paginates chronologically", () => {
    const many: TimelineSourceRow[] = Array.from({ length: 30 }, (_, i) => ({
      eventType: "plan.attended_together",
      actorId: ALICE,
      occurredAt: at(i + 1),
      payload: { subjectId: BOB }
    }));

    const first = buildTimeline(many, ALICE, { limit: 10 });
    expect(first.entries).toHaveLength(10);
    expect(first.nextBeforeMs).not.toBeNull();

    const second = buildTimeline(many, ALICE, { limit: 10, beforeMs: first.nextBeforeMs! });
    expect(second.entries).toHaveLength(10);
    // No overlap between pages.
    const firstIds = new Set(first.entries.map((entry) => entry.occurredAtMs));
    for (const entry of second.entries) expect(firstIds.has(entry.occurredAtMs)).toBe(false);
  });

  it("reports the end of the list", () => {
    const { nextBeforeMs } = buildTimeline(rows, ALICE, { limit: 50 });
    expect(nextBeforeMs).toBeNull();
  });

  it("rebuilds identically from the same log", () => {
    // The projection is a function of the events and nothing else.
    expect(buildTimeline(rows, ALICE)).toEqual(buildTimeline([...rows].reverse(), ALICE));
  });

  it("derives counts and dates, never a characterisation", () => {
    const facts = timelineFacts(buildTimeline(rows, ALICE).entries);
    expect(facts.plansAttendedTogether).toBe(2);
    expect(facts.interactionCount).toBe(2);
    expect(facts.createdAtMs).not.toBeNull();
    // Nothing resembling a score.
    expect(Object.keys(facts)).not.toContain("score");
    expect(Object.keys(facts)).not.toContain("health");
  });
});

// ---------------------------------------------------------------------------
// Reconnect
// ---------------------------------------------------------------------------

describe("reconnect eligibility", () => {
  const base: ReconnectFacts = {
    endedAtMs: null,
    lastInteractionAtMs: NOW - 60 * DAY,
    interactionCount: 5,
    blocked: false,
    dismissedAtMs: null,
    snoozedUntilMs: null,
    lastReconnectAtMs: null
  };

  it("suggests a catch-up after a long quiet period", () => {
    const decision = evaluateReconnect(base, NOW);
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe("eligible");
  });

  it("stays quiet while the friendship is active and recent", () => {
    const decision = evaluateReconnect({ ...base, lastInteractionAtMs: NOW - 7 * DAY }, NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("recent_interaction");
    expect(decision.nextEligibleAtMs).toBe(NOW - 7 * DAY + RECONNECT_QUIET_PERIOD_MS);
  });

  it("never suggests a blocked person, and never will", () => {
    const decision = evaluateReconnect({ ...base, blocked: true }, NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("blocked");
    expect(decision.nextEligibleAtMs).toBeNull();
  });

  it("checks blocking before anything else", () => {
    // A blocked pair must not even be evaluated for eligibility.
    const decision = evaluateReconnect(
      { ...base, blocked: true, snoozedUntilMs: NOW + DAY, dismissedAtMs: NOW },
      NOW
    );
    expect(decision.reason).toBe("blocked");
  });

  it("respects a snooze", () => {
    const decision = evaluateReconnect({ ...base, snoozedUntilMs: NOW + 10 * DAY }, NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("snoozed");
  });

  it("respects a dismissal for a long time", () => {
    const decision = evaluateReconnect({ ...base, dismissedAtMs: NOW - DAY }, NOW);
    expect(decision.reason).toBe("recently_dismissed");
    // And becomes eligible again eventually, rather than never.
    expect(evaluateReconnect({ ...base, dismissedAtMs: NOW - RECONNECT_DISMISSAL_MS - DAY }, NOW).eligible).toBe(true);
  });

  it("leaves a pair alone after they reconnect", () => {
    const decision = evaluateReconnect({ ...base, lastReconnectAtMs: NOW - DAY }, NOW);
    expect(decision.reason).toBe("recently_reconnected");
    expect(decision.nextEligibleAtMs).toBe(NOW - DAY + RECONNECT_COOLDOWN_MS);
  });

  it("does not suggest reconnecting with someone barely known", () => {
    const decision = evaluateReconnect({ ...base, interactionCount: RECONNECT_MIN_INTERACTIONS - 1 }, NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe("never_interacted");
  });

  it("is deterministic", () => {
    expect(evaluateReconnect(base, NOW)).toEqual(evaluateReconnect(base, NOW));
    const source = stripComments(read("lib/life/reconnect.ts"));
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("Date.now");
  });

  it("uses a genuinely long quiet period", () => {
    // Nagging about a normal fortnight would make the product feel needy.
    expect(RECONNECT_QUIET_PERIOD_MS).toBeGreaterThanOrEqual(30 * DAY);
  });

  it("never judges the friendship", () => {
    const copy = reconnectSuggestionCopy("Ama");
    const text = `${copy.title} ${copy.body}`.toLowerCase();
    for (const banned of RECONNECT_FORBIDDEN_WORDS) {
      expect(text, `must not say "${banned}"`).not.toContain(banned);
    }
  });

  it("keeps the suggestion warm and optional", () => {
    const copy = reconnectSuggestionCopy("Ama");
    expect(copy.title).toContain("Ama");
    expect(copy.body.toLowerCase()).toContain("no rush");
  });

  it("handles a missing name without producing an empty sentence", () => {
    expect(reconnectSuggestionCopy("   ").title).toContain("your Muddy");
  });

  it("returns no number a caller could render as a score", () => {
    const decision = evaluateReconnect(base, NOW);
    expect(Object.keys(decision)).toEqual(["eligible", "reason", "nextEligibleAtMs"]);
  });
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

describe("milestones", () => {
  it("reports factual thresholds", () => {
    const reached = milestonesFor(
      { createdAtMs: null, plansAttendedTogether: 5, reconnectsCompleted: 0 },
      NOW
    ).map((milestone) => milestone.code);
    expect(reached).toContain("first_plan_together");
    expect(reached).toContain("five_plans_together");
    expect(reached).not.toContain("ten_plans_together");
  });

  it("adds one anniversary per completed year", () => {
    const twoYears = NOW - 2 * 365 * DAY - DAY;
    const reached = milestonesFor(
      { createdAtMs: twoYears, plansAttendedTogether: 0, reconnectsCompleted: 0 },
      NOW
    ).map((milestone) => milestone.code);
    expect(reached).toContain("anniversary_year_1");
    expect(reached).toContain("anniversary_year_2");
    expect(reached).not.toContain("anniversary_year_3");
  });

  it("is idempotent across rebuilds", () => {
    const facts = { createdAtMs: NOW - 400 * DAY, plansAttendedTogether: 7, reconnectsCompleted: 1 };
    expect(milestonesFor(facts, NOW)).toEqual(milestonesFor(facts, NOW));
  });

  it("produces stable dedupe keys whichever side computes them", () => {
    expect(milestoneDedupeKey(ALICE, BOB, "first_plan_together")).toBe(
      milestoneDedupeKey(BOB, ALICE, "first_plan_together")
    );
  });

  it("never implies relationship quality", () => {
    const reached = milestonesFor(
      { createdAtMs: NOW - 800 * DAY, plansAttendedTogether: 12, reconnectsCompleted: 2 },
      NOW
    );
    for (const milestone of reached) {
      for (const banned of MILESTONE_FORBIDDEN_WORDS) {
        expect(milestone.label.toLowerCase(), `${milestone.code} must not say "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("reports nothing for a relationship with no history", () => {
    expect(milestonesFor({ createdAtMs: null, plansAttendedTogether: 0, reconnectsCompleted: 0 }, NOW)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Module boundaries
// ---------------------------------------------------------------------------

describe("module boundaries", () => {
  const modules = ["lib/life/events.ts", "lib/life/timeline.ts", "lib/life/reconnect.ts", "lib/life/milestones.ts"];

  it("stays pure — no queries, no React, no AI", () => {
    for (const path of modules) {
      const source = stripComments(read(path));
      for (const banned of ["createSupabase", "fetch(", "useState", "useEffect", "openai", "anthropic"]) {
        expect(source, `${path} must not use ${banned}`).not.toContain(banned);
      }
    }
  });

  it("never reads message content anywhere in the domain", () => {
    for (const path of modules) {
      const source = stripComments(read(path));
      for (const banned of ['from("messages")', "message_text", "messageBody"]) {
        expect(source, `${path} must not touch ${banned}`).not.toContain(banned);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Feature flags and gating
// ---------------------------------------------------------------------------

describe("Life ships dark", () => {
  const flags = read("lib/features/feature-flags.ts");

  it("registers every Life capability as a managed flag", () => {
    for (const key of [
      "life_timeline",
      "life_relationship_notes",
      "life_reconnect",
      "life_birthdays",
      "life_milestones"
    ]) {
      expect(flags, `${key} must be a managed flag`).toContain(`"${key}"`);
    }
  });

  it("defaults to off, with no migration enabling them", () => {
    // isFeatureEnabled returns false for a key with no row, so an unregistered
    // Life flag is off in production without any deploy step.
    expect(flags).toContain("if (error) return false;");
    const migrations = read("supabase/migrations/20260806220000_life_relationship_notes.sql");
    expect(migrations).not.toContain("feature_flags");
  });

  it("keeps flags separate from entitlements", () => {
    // Flags control EXISTENCE; entitlements control ACCESS. Conflating them
    // means a sold feature cannot be switched off.
    const modules = ["lib/life/events.ts", "lib/life/timeline.ts", "lib/life/reconnect.ts", "lib/life/milestones.ts"];
    for (const path of modules) {
      const source = stripComments(read(path));
      expect(source, `${path} must not gate on entitlements yet`).not.toContain("checkFeature");
      expect(source, `${path} must not read a plan`).not.toContain("buddy_pro");
    }
  });
});

// ---------------------------------------------------------------------------
// Notes privacy
// ---------------------------------------------------------------------------

describe("relationship notes privacy", () => {
  const migration = read("supabase/migrations/20260806220000_life_relationship_notes.sql");

  it("is author-owned with no read path for the subject", () => {
    // The defining rule: a note about you is not yours to read.
    expect(migration).toContain("using (auth.uid() = author_id)");
    expect(migration).not.toContain("subject_id = auth.uid()");
    expect(migration).not.toContain("or auth.uid() = subject_id");
  });

  it("enables row level security", () => {
    expect(migration).toContain("alter table public.relationship_notes enable row level security;");
    expect(migration).toContain("create policy");
  });

  it("records notes as user-authored, never derived", () => {
    // A future AI-suggested note must never masquerade as one the user wrote.
    expect(migration).toContain("source text not null default 'user'");
    expect(migration).toContain("check (source in ('user'))");
  });

  it("survives unfriending but not account deletion", () => {
    // The memory outlives the friendship; nothing outlives the account.
    expect(migration).toContain("on delete cascade");
    expect(migration).not.toContain("references public.friendships");
  });

  it("refuses a note about yourself", () => {
    expect(migration).toContain("check (author_id <> subject_id)");
  });

  it("bounds note length", () => {
    expect(migration).toContain("char_length(body) between 1 and 2000");
  });
});
