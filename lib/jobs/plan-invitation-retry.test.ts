import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Push delivery is deferred through Next's after(), which throws outside a
 * request scope. Stubbed so these tests exercise notification PERSISTENCE --
 * the thing a retry can duplicate -- rather than Next's request lifecycle.
 * Running the callback inline keeps the behaviour under test intact.
 */
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));

const { handlePlanLifecycleSideEffect } = await import("@/lib/jobs/handlers");

/**
 * One invitation, one notification -- even when the worker dies mid-flight.
 *
 * THE WINDOW. The lifecycle transaction enqueues uniquely keyed jobs, so the
 * same logical invitation cannot be enqueued twice. That is JOB idempotency.
 * It says nothing about the EFFECT: a worker that delivered the notification
 * and then crashed before recording completion left the job retryable, and
 * notifications are inserted rather than upserted -- so the invitee heard
 * about one invitation twice.
 *
 * These drive the real handler against an in-memory Supabase double and assert
 * what the recipient ends up with, not which functions were called.
 */

const PLAN = "11111111-1111-4111-8111-111111111111";
const PLAN_B = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const INVITEE = "44444444-4444-4444-8444-444444444444";
const INVITEE_B = "55555555-5555-4555-8555-555555555555";

type Job = { id: string; idempotency_key: string; payload: Record<string, unknown> };

/**
 * Minimal Supabase double.
 *
 * Models only what this handler touches, including the one behaviour the whole
 * fix depends on: an UPDATE filtered on `payload->>delivered is null` matches
 * the row once and never again.
 */
function makeAdmin(options: { jobs: Job[]; participants?: string[] }) {
  const notifications: Array<{ user_id: string; type: string; title: string }> = [];
  const milestones: Array<{ user_id: string; milestone: string }> = [];
  const participants = options.participants ?? [INVITEE, INVITEE_B];

  const builder = (table: string) => {
    const state: Record<string, unknown> = { table, filters: {} as Record<string, string> };

    const api: Record<string, unknown> = {
      select() {
        if (table === "jobs") {
          const key = (state.filters as Record<string, string>).idempotency_key;
          const job = options.jobs.find((j) => j.idempotency_key === key);
          // The `is("payload->>delivered", null)` guard: only an unclaimed row
          // matches, which is what makes the second attempt a no-op.
          if (!job || job.payload.delivered) return Promise.resolve({ data: [] });
          // The handler updates the `payload` COLUMN, so the new payload is
          // nested inside the update object rather than being it.
          const update = state.pendingUpdate as { payload?: Record<string, unknown> } | undefined;
          if (update?.payload) job.payload = update.payload;
          return Promise.resolve({ data: [{ id: job.id }] });
        }
        return api;
      },
      update(values: Record<string, unknown>) {
        state.pendingUpdate = values;
        return api;
      },
      insert(values: Record<string, unknown>) {
        if (table === "notifications") {
          notifications.push(values as { user_id: string; type: string; title: string });
        }
        return Promise.resolve({ error: null });
      },
      upsert(values: Record<string, unknown>) {
        if (table === "activation_milestones") {
          const row = values as { user_id: string; milestone: string };
          const exists = milestones.some(
            (m) => m.user_id === row.user_id && m.milestone === row.milestone
          );
          if (!exists) milestones.push(row);
        }
        return Promise.resolve({ error: null });
      },
      eq(column: string, value: string) {
        (state.filters as Record<string, string>)[column] = value;
        return api;
      },
      /**
       * Filter columns are not modelled.
       *
       * WHAT THIS MEANS FOR THESE TESTS. The double enforces "claimed once"
       * from its own record of the job payload, so removing the latch fails
       * these tests -- but changing the `.is()` COLUMN would not, because no
       * double reproduces Postgres predicate evaluation. That half of the
       * guarantee lives in the database and is asserted separately below
       * against the handler's actual query.
       */
      is() {
        return api;
      },
      in() {
        return api;
      },
      maybeSingle() {
        const filters = state.filters as Record<string, string>;
        if (table === "plans") {
          return Promise.resolve({ data: { creator_id: ACTOR, title: "Jollof night" } });
        }
        if (table === "plan_participants") {
          return Promise.resolve({
            data: participants.includes(filters.user_id) ? { rsvp_status: "invited" } : null
          });
        }
        if (table === "profiles") return Promise.resolve({ data: { full_name: "Ama" } });
        if (table === "user_preferences") return Promise.resolve({ data: null });
        if (table === "engagement_preferences") return Promise.resolve({ data: null });
        if (table === "notification_budget_usage") return Promise.resolve({ data: null });
        return Promise.resolve({ data: null });
      },
      then(resolve: (value: { data: unknown[] }) => unknown) {
        return Promise.resolve({ data: [] }).then(resolve);
      }
    };
    return api;
  };

  return {
    admin: { from: (table: string) => builder(table) } as never,
    notifications,
    milestones
  };
}

const invitePayload = (planId = PLAN, recipientId = INVITEE) => ({
  kind: "plan_invitation",
  planId,
  actorId: ACTOR,
  recipientId
});

const inviteJob = (planId = PLAN, recipientId = INVITEE): Job => ({
  id: `job-${planId}-${recipientId}`,
  idempotency_key: `plan-invite:${planId}:${recipientId}`,
  payload: invitePayload(planId, recipientId)
});

describe("the crash-after-delivery window", () => {
  it("delivers exactly one notification when the same job is retried", async () => {
    // 1. job runs, 2. notification persists, 3. worker dies before completing,
    // 4. the same logical job is retried, 5. recipient has ONE invitation.
    const jobs = [inviteJob()];
    const { admin, notifications } = makeAdmin({ jobs });

    await handlePlanLifecycleSideEffect(admin, invitePayload());
    await handlePlanLifecycleSideEffect(admin, invitePayload());

    expect(notifications).toHaveLength(1);
  });

  it("survives many retries, not just one", async () => {
    const jobs = [inviteJob()];
    const { admin, notifications } = makeAdmin({ jobs });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await handlePlanLifecycleSideEffect(admin, invitePayload());
    }

    expect(notifications).toHaveLength(1);
  });

  it("reports success on the retry rather than failing forever", async () => {
    // A retry that found the invitation already delivered must let the job
    // complete. Throwing would dead-letter work that actually succeeded.
    const jobs = [inviteJob()];
    const { admin } = makeAdmin({ jobs });

    await handlePlanLifecycleSideEffect(admin, invitePayload());
    await expect(handlePlanLifecycleSideEffect(admin, invitePayload())).resolves.toBe(0);
  });

  it("claims before delivering, so a crash loses a notification rather than doubling it", async () => {
    const jobs = [inviteJob()];
    const { admin } = makeAdmin({ jobs });

    await handlePlanLifecycleSideEffect(admin, invitePayload());
    // The latch is stamped on the job row, which outlives the worker.
    expect(jobs[0].payload.delivered).toBe(true);
  });
});

describe("legitimate notifications are not suppressed", () => {
  it("gives two different invitees their own notification", async () => {
    const jobs = [inviteJob(PLAN, INVITEE), inviteJob(PLAN, INVITEE_B)];
    const { admin, notifications } = makeAdmin({ jobs });

    await handlePlanLifecycleSideEffect(admin, invitePayload(PLAN, INVITEE));
    await handlePlanLifecycleSideEffect(admin, invitePayload(PLAN, INVITEE_B));

    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.user_id).sort()).toEqual([INVITEE, INVITEE_B].sort());
  });

  it("lets two different Plans each notify the same person", async () => {
    // The key is per plan AND per recipient, so a second Plan is a second
    // invitation -- not a duplicate of the first.
    const jobs = [inviteJob(PLAN, INVITEE), inviteJob(PLAN_B, INVITEE)];
    const { admin, notifications } = makeAdmin({ jobs });

    await handlePlanLifecycleSideEffect(admin, invitePayload(PLAN, INVITEE));
    await handlePlanLifecycleSideEffect(admin, invitePayload(PLAN_B, INVITEE));

    expect(notifications).toHaveLength(2);
  });
});

describe("the milestone branch is untouched", () => {
  const milestonePayload = { kind: "first_plan_milestone", planId: PLAN, actorId: ACTOR };

  it("stays idempotent across retries", async () => {
    const { admin, milestones } = makeAdmin({ jobs: [] });

    await handlePlanLifecycleSideEffect(admin, milestonePayload);
    await handlePlanLifecycleSideEffect(admin, milestonePayload);

    expect(milestones).toHaveLength(1);
  });

  it("does not depend on the invitation latch", async () => {
    // It has no job row here at all, and still succeeds -- its idempotency
    // comes from its own upsert, which this change must not disturb.
    const { admin } = makeAdmin({ jobs: [] });
    await expect(handlePlanLifecycleSideEffect(admin, milestonePayload)).resolves.toBe(1);
  });
});

describe("the claim query itself", () => {
  // The behavioural tests above cannot check WHICH column the claim filters on,
  // because no in-memory double evaluates a Postgres predicate. These assert
  // the query the database will actually run, so a latch pointed at the wrong
  // column or missing its guard is still caught.
  const handlers = readFileSync("lib/jobs/handlers.ts", "utf8");
  const claim = handlers.slice(
    handlers.indexOf("const inviteJobKey"),
    handlers.indexOf("const name = actor?.full_name")
  );

  it("scopes the claim to this exact plan and recipient", () => {
    expect(claim).toContain("`plan-invite:${planId}:${recipientId}`");
    expect(claim).toContain('.eq("idempotency_key", inviteJobKey)');
  });

  it("only claims a row that has not already been delivered", () => {
    expect(claim).toContain('.is("payload->>delivered", null)');
  });

  it("marks delivery on the durable job row", () => {
    expect(claim).toContain("delivered: true");
  });

  it("claims before delivering, never after", () => {
    // Ordering is the guarantee: a crash between the two loses a notification
    // rather than sending it twice.
    expect(handlers.indexOf("delivered: true")).toBeLessThan(
      handlers.indexOf("title: kind === \"upfor_converted\"")
    );
  });
});

describe("validation is unchanged", () => {
  it("rejects a malformed identifier", async () => {
    const { admin } = makeAdmin({ jobs: [] });
    await expect(
      handlePlanLifecycleSideEffect(admin, { kind: "plan_invitation", planId: "nope", actorId: ACTOR })
    ).rejects.toThrow();
  });

  it("refuses to notify someone who is no longer a participant", async () => {
    const jobs = [inviteJob()];
    const { admin, notifications } = makeAdmin({ jobs, participants: [] });

    await expect(handlePlanLifecycleSideEffect(admin, invitePayload())).rejects.toThrow();
    expect(notifications).toHaveLength(0);
  });
});
