import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalPlanErrorIdentifier,
  mapCanonicalPlanError,
  toCanonicalPlanLimit
} from "@/lib/plans/canonical-contract";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const service = read("lib/plans/service.ts");
const actions = read("app/(app)/plans-actions.ts");
const hangouts = read("app/(app)/hangout-actions.ts");
const apiRoute = read("app/api/plans/route.ts");
const rsvpRoute = read("app/api/plans/[id]/rsvp/route.ts");
const webPlans = read("components/plans/plans-page.tsx");
const mobilePlans = read("mobile/src/screens/PlansScreen.tsx");
const messaging = read("lib/messaging/service.ts");
const jobs = read("lib/jobs/handlers.ts");

describe("canonical Plans application contract", () => {
  it("maps database failures to stable privacy-safe errors", () => {
    expect(mapCanonicalPlanError({ message: "PLAN_NOT_FOUND" }, "fallback")).toMatchObject({
      code: "not_found",
      message: "Plan not found."
    });
    expect(mapCanonicalPlanError({ details: "PLAN_PARTICIPANT_INELIGIBLE" }, "fallback")).toMatchObject({
      code: "ineligible"
    });
    expect(mapCanonicalPlanError({ hint: "PLAN_RSVP_DEADLINE_PASSED" }, "fallback")).toMatchObject({
      code: "deadline_passed"
    });
    expect(mapCanonicalPlanError({ message: "internal relation detail" }, "Try again.")).toEqual({
      ok: false,
      code: "server_unavailable",
      message: "Try again."
    });
    expect(canonicalPlanErrorIdentifier({ message: "PLAN_ACTIVE_LIMIT_REACHED" })).toBe(
      "PLAN_ACTIVE_LIMIT_REACHED"
    );
  });

  it("normalises unlimited entitlements without accepting a client limit", () => {
    expect(toCanonicalPlanLimit(Number.POSITIVE_INFINITY)).toBe(2_147_483_647);
    expect(toCanonicalPlanLimit(50)).toBe(50);
    expect(service).toContain("getCurrentSubscriptionAccess(userId)");
    expect(service).toContain("planTierLimitsFor(access.plan)");
    expect(service).not.toMatch(/maxActivePlans:\s*z\./);
    expect(service).not.toMatch(/maxPlanParticipants:\s*z\./);
  });

  it("routes every supported mutation through the service-role-only RPCs", () => {
    expect(service).toContain('admin.rpc("create_plan_lifecycle"');
    expect(service).toContain('admin.rpc("set_plan_participant_rsvp"');
    expect(service).toContain('admin.rpc("add_plan_participants"');
    expect(service).not.toContain('.from("plans")\n    .insert(');
    expect(service).not.toContain('.from("plan_participants")\n    .insert(');
    expect(service).not.toContain('.from("plan_participants")\n    .update(');
    expect(messaging).toContain('admin.rpc("reconcile_plan_conversation_members"');
  });

  it("derives actors from authenticated web and mobile boundaries", () => {
    expect(actions).toContain("const userId = await getAuthedUserId()");
    expect(actions).toContain("return createPlan(userId, input)");
    expect(actions).toContain("return rsvp(userId, planId, status)");
    expect(apiRoute).toContain("resolveApiUser(request)");
    expect(apiRoute).toContain("createPlan(auth.user.id, input)");
    expect(rsvpRoute).toContain("rsvp(auth.user.id, id, body.data.status)");
    expect(service).toContain("p_actor_id: userId");
    expect(service).not.toMatch(/actorId:\s*z\./);
  });

  it("persists one request key across retries on web and mobile", () => {
    for (const client of [webPlans, mobilePlans]) {
      expect(client).toMatch(/\w*RequestKeyRef|requestKeyRef/);
      expect(client).toContain("crypto.randomUUID()");
      expect(client).toContain("requestKey:");
    }
    expect(service).toContain("requestKey: uuidSchema");
    expect(service).toContain("p_request_key: parsed.data.requestKey");
    expect(service).toContain("p_request_key: hangoutId");
  });

  it("eliminates the UpFor and participant split-write paths", () => {
    /* Asserted as the CONTRACT -- conversion goes through the canonical service
       and there is no second Plan write -- rather than as the literal line
       `return convertHangoutToPlan(...)`. That spelling broke when the action
       started capturing the result to return the conversation id and notify
       accepted participants, neither of which introduces another Plan path. */
    expect(hangouts).toContain("convertHangoutToPlan(userId, hangoutId, title)");
    expect(hangouts).not.toContain("source_hangout_id: hangoutId");
    // No hand-rolled Plan or plan-participant writes anywhere in the action.
    expect(hangouts).not.toContain('.from("plans")');
    expect(hangouts).not.toContain('.from("plan_participants")');
    expect(actions).toContain("return addPlanParticipants(userId, planId, participantIds)");
    expect(actions).toContain('rsvp(userId, planId, "not_going")');
    expect(actions).not.toContain('.from("plan_participants").upsert(');
  });

  it("handles canonical after-commit side effects instead of dead-lettering them", () => {
    expect(jobs).toContain('"plans.lifecycle_side_effect": handlePlanLifecycleSideEffect');
    expect(jobs).toContain('kind === "first_plan_milestone"');
    expect(jobs).toContain("recordMilestone(admin, actorId, \"first_plan_created\")");
    expect(jobs).toContain("deliverNotification(admin");
  });

  it("keeps privileged credentials out of both Plan clients", () => {
    for (const client of [webPlans, mobilePlans]) {
      expect(client).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(client).not.toContain("serviceRoleKey");
      expect(client).not.toContain("createSupabaseAdminClient");
    }
    expect(service.startsWith('import "server-only";')).toBe(true);
  });
});
