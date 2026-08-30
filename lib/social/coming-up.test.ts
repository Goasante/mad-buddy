import { describe, expect, it } from "vitest";
import { buildComingUp, type ComingUpUpForSource } from "@/lib/social/coming-up";
import type { UpcomingAgendaItem } from "@/lib/social/upcoming-agenda-projection";

const NOW = Date.parse("2026-07-17T14:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

const plan = (id: string, startMin: number): UpcomingAgendaItem =>
  ({ kind: "plan", id, title: `Plan ${id}`, startsAt: at(startMin), endsAt: at(startMin + 60) }) as UpcomingAgendaItem;

const upfor = (id: string, startMin: number, status = "active"): ComingUpUpForSource => ({
  id,
  title: `UpFor ${id}`,
  status,
  startsAt: at(startMin),
  endsAt: at(startMin + 120)
});

describe("what Coming Up contains", () => {
  it("shows a scheduled UpFor and a future Plan together", () => {
    const items = buildComingUp([plan("p1", 210)], [upfor("u1", 47)], NOW);
    expect(items.map((i) => i.kind)).toEqual(["upfor", "agenda"]);
  });

  it("excludes an ACTIVE UpFor: it is happening, not coming up", () => {
    expect(buildComingUp([], [upfor("u1", -30)], NOW)).toEqual([]);
  });

  it("excludes cancelled, expired and converted UpFors", () => {
    for (const status of ["cancelled", "expired", "converted_to_plan"] as const) {
      // Given a future start, so only the lifecycle can exclude them.
      expect(buildComingUp([], [upfor("u1", 60, status)], NOW), status).toEqual([]);
    }
  });

  it("keeps types distinct rather than flattening them", () => {
    const items = buildComingUp([plan("p1", 30)], [upfor("u1", 60)], NOW);
    expect(items[0]!.kind).toBe("agenda");
    expect(items[1]!.kind).toBe("upfor");
  });
});

describe("ordering", () => {
  it("sorts by when things actually start, across both types", () => {
    const items = buildComingUp(
      [plan("p1", 120), plan("p2", 20)],
      [upfor("u1", 60), upfor("u2", 200)],
      NOW
    );
    expect(items.map((i) => i.id)).toEqual(["plan:p2", "upfor:u1", "plan:p1", "upfor:u2"]);
  });

  it("is stable when two things start at the same moment", () => {
    // Ties break on id so the list does not reshuffle on every countdown tick.
    const a = buildComingUp([plan("p1", 60)], [upfor("u1", 60)], NOW);
    const b = buildComingUp([plan("p1", 60)], [upfor("u1", 60)], NOW);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
  });

  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => upfor(`u${i}`, 10 + i * 10));
    expect(buildComingUp([], many, NOW, 6)).toHaveLength(6);
  });
});

describe("UpFor to Plan conversion produces no duplicate", () => {
  it("drops the UpFor in the same pass the Plan appears", () => {
    // BEFORE: a scheduled UpFor at 18:00, no Plan.
    const before = buildComingUp([], [upfor("u1", 240)], NOW);
    expect(before.map((i) => i.kind)).toEqual(["upfor"]);

    // AFTER: conversion marks the UpFor converted_to_plan and creates a Plan
    // at the same time. Exactly one item, and it is the Plan.
    const after = buildComingUp([plan("p9", 240)], [upfor("u1", 240, "converted_to_plan")], NOW);
    expect(after).toHaveLength(1);
    expect(after[0]!.kind).toBe("agenda");
  });

  it("never shows the old UpFor and the new Plan at once", () => {
    const items = buildComingUp([plan("p9", 240)], [upfor("u1", 240, "converted_to_plan")], NOW);
    expect(items.filter((i) => i.kind === "upfor")).toHaveLength(0);
  });
});

describe("bad data degrades quietly", () => {
  it("skips an agenda item with an unreadable start", () => {
    const broken = { kind: "plan", id: "x", title: "x", startsAt: "nope", endsAt: null } as unknown as UpcomingAgendaItem;
    expect(buildComingUp([broken], [], NOW)).toEqual([]);
  });

  it("skips an UpFor with unreadable timestamps", () => {
    expect(
      buildComingUp([], [{ id: "u", title: "u", status: "active", startsAt: "x", endsAt: "y" }], NOW)
    ).toEqual([]);
  });
});
