import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";

/**
 * Every surface answers "is this plan still on?" the same way.
 *
 * THE BUG THIS EXISTS FOR. Four places decided independently, and all four
 * disagreed:
 *
 *   - the Plans page bucketed on isPastPlan, which returned false for a null
 *     start -- so undated plans sat in Upcoming forever (nine of them in
 *     production, six accounts, up to 23 days old);
 *   - Home filtered in SQL with `.gte("start_at", nowIso)`, dropping a plan
 *     the moment it began even when it ran for hours;
 *   - Pulse applied no time check at all to plan invites, so an invitation to
 *     a plan that had already happened kept asking to be answered;
 *   - the completion job filtered on `end_at` alone, and every dated plan in
 *     production has a null end_at -- so it had never completed a single one,
 *     leaving them at `inviting` while the UI already called them past.
 *
 * The rule now lives in lib/social/plans.ts and these assert that nothing has
 * gone back to deciding for itself.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const helper = stripComments(read("lib/social/plans.ts"));
const home = stripComments(read("lib/social/upcoming-plans.ts"));
const plansPage = stripComments(read("components/plans/plans-page.tsx"));
const plansRoute = stripComments(read("app/(app)/plans/page.tsx"));
const planService = stripComments(read("lib/plans/service.ts"));
const pulse = stripComments(read("app/api/pulse/route.ts"));
const jobs = stripComments(read("lib/jobs/handlers.ts"));

// ---------------------------------------------------------------------------
// One rule
// ---------------------------------------------------------------------------

describe("the lifecycle rule lives in exactly one place", () => {
  it("exports the canonical phase resolver", () => {
    expect(helper).toContain("export function planPhase");
    for (const phase of ['"upcoming"', '"past"', '"unscheduled"', '"archived_unscheduled"']) {
      expect(helper, `planPhase must model ${phase}`).toContain(phase);
    }
  });

  it("takes no participant argument, so RSVP cannot reach it", () => {
    // Structural guarantee: going / maybe / not_going / invited / host all
    // resolve identically because none of them is an input.
    const signature = helper.slice(helper.indexOf("export function planPhase"));
    const args = signature.slice(signature.indexOf("("), signature.indexOf(")"));
    expect(args).not.toContain("rsvp");
    expect(args).not.toContain("participant");
    expect(args).not.toContain("viewer");
  });

  it("keeps the grace period as a single exported constant", () => {
    expect(helper).toContain("export const UNSCHEDULED_PLAN_GRACE_DAYS = 14");
    // And no plan surface re-derives the window for itself. Deliberately
    // scoped to the surfaces: lib/jobs also contains a 14-day streaks window
    // that has nothing to do with plans, and a blanket search for the number
    // would fail on it.
    for (const [name, source] of [
      ["Home", home],
      ["Plans page", plansPage],
      ["pulse", pulse]
    ] as const) {
      expect(source, `${name} must not hardcode the grace window`).not.toContain("14 * 24 * 60 * 60");
      expect(source, `${name} must not restate the constant`).not.toMatch(/GRACE_DAYS\s*=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Every surface defers to it
// ---------------------------------------------------------------------------

describe("no surface decides for itself", () => {
  it("Home re-checks its SQL against the helper", () => {
    expect(home).toContain("isUpcomingPlan(");
    expect(home).toContain('from "@/lib/social/plans"');
  });

  it("Home reads end_at, so a running plan is not dropped mid-way", () => {
    expect(home).toContain("end_at");
    // The old filter was start-only; it now casts wide enough for the helper
    // to make the real decision.
    expect(home).toContain("start_at.gte.");
    expect(home).toContain("end_at.gte.");
  });

  it("Home judges the SQL and the re-check against one clock", () => {
    // Two Date.now() calls either side of a slow query could otherwise
    // disagree about a plan starting in that gap.
    expect(home).toContain("const nowMs = Date.now()");
    expect(home).toContain("new Date(nowMs).toISOString()");
  });

  it("the Plans page buckets on the phase, not on role first", () => {
    expect(plansPage).toContain("const phase = planPhase(plan)");
    // Phase decides before host/invited, which is what stopped an undated
    // plan being filed under Upcoming or Created by you indefinitely.
    const bucket = plansPage.slice(plansPage.indexOf("function bucketFor"));
    const body = bucket.slice(0, bucket.indexOf("\n}"));
    expect(body.indexOf("planPhase")).toBeLessThan(body.indexOf("plan.isHost"));
  });

  it("the Plans page gives undated plans their own bucket", () => {
    expect(plansPage).toContain('"unscheduled"');
    expect(plansPage).toContain("Waiting on a time");
    // Archived ones stay reachable there rather than vanishing.
    expect(plansPage).toContain('phase === "unscheduled" || phase === "archived_unscheduled"');
  });

  it("pulse stops nagging about plans nobody can attend", () => {
    expect(pulse).toContain("planPhase({");
    expect(pulse).toContain('phase === "past" || phase === "archived_unscheduled"');
  });

  it("both plan projections carry the fields the helper needs", () => {
    // end_at and created_at were written but never selected, so the client
    // could not tell a running plan from a finished one, nor measure a grace
    // window. Both loaders now read them.
    for (const [name, source] of [
      ["Plans route", plansRoute],
      ["plans service", planService]
    ] as const) {
      expect(source, `${name} must select end_at`).toContain("end_at");
      expect(source, `${name} must select created_at`).toContain("created_at");
      expect(source, `${name} must project endAt`).toContain("endAt:");
      expect(source, `${name} must project createdAt`).toContain("createdAt:");
    }
  });
});

// ---------------------------------------------------------------------------
// The completion job
// ---------------------------------------------------------------------------

describe("the completion job matches the read-time rule", () => {
  it("completes start-only plans, which is every dated plan in production", () => {
    // `.lt("end_at", nowIso)` alone matched nothing, so plans sat at
    // `inviting` forever while the UI had already moved them to Past.
    const job = jobs.slice(jobs.indexOf("handleCompletePastPlans"));
    expect(job.slice(0, 900)).toContain("end_at.is.null,start_at.lt.");
  });

  it("still completes plans that do have an end time", () => {
    const job = jobs.slice(jobs.indexOf("handleCompletePastPlans"));
    expect(job.slice(0, 900)).toContain("end_at.lt.");
  });

  it("never touches undated plans", () => {
    // They are set aside at read time by the grace window, which needs no
    // write and is undone by simply adding a date. A job that completed them
    // would be a destructive, one-way version of the same thing.
    const job = jobs.slice(jobs.indexOf("handleCompletePastPlans"), jobs.indexOf("handleExpireStatuses"));
    expect(job).not.toContain("start_at.is.null");
  });

  it("only ever moves plans out of live statuses", () => {
    const job = jobs.slice(jobs.indexOf("handleCompletePastPlans"));
    expect(job.slice(0, 900)).toContain('.in("status", ["inviting", "confirmed"])');
  });
});

// ---------------------------------------------------------------------------
// Nothing is deleted
// ---------------------------------------------------------------------------

describe("setting a plan aside is not deleting it", () => {
  it("derives the archived state rather than writing it", () => {
    // No migration, no column, no job: purely a function of timestamps, so
    // changing the grace period changes the outcome retroactively and
    // nothing has to be undone.
    expect(helper).toContain("export function isArchivedUnscheduledPlan");
    expect(jobs).not.toContain("archived_unscheduled");
  });

  it("tells the owner what happened instead of going quiet", () => {
    expect(plansPage).toContain("Set aside");
    expect(plansPage).toContain("add a time to bring it back");
  });

  it("no longer shows a bare permanent TBD", () => {
    // The label people were actually seeing, forever.
    expect(plansPage).not.toContain("Time TBD");
  });
});
