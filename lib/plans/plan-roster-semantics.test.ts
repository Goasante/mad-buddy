import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * A Plan is a guest list, not a leaderboard.
 *
 * The detail sheet was describing the people in it with two things that were
 * not about the meeting: a subscription tier beside each name, and a heading
 * that counted only confirmations while listing everyone. The migration is the
 * authority on the third rule -- who is actually in the Plan Chat.
 */

const source = readFileSync("components/plans/plans-page.tsx", "utf8");
const plans = stripComments(source);

/* Tight slices. An earlier test in this repo matched `proximityLevel` against
   the whole file and passed on unrelated markup, so each rule below is scoped
   to the one component it governs. */
const detail = plans.slice(plans.indexOf("function PlanDetailsModal"), plans.indexOf("function AddPollForm"));
const card = plans.slice(plans.indexOf("function PlanCard"), plans.indexOf("function localDateValue"));

describe("a Plan roster describes the meeting, not the billing", () => {
  it("shows no subscription tier in the attendee list", () => {
    expect(detail).toContain("plan.attendees.map");
    expect(detail).not.toContain("PremiumPlanBadge");
  });

  it("shows no subscription tier for the organiser on the Plans index", () => {
    expect(card).toContain("plan.organiserName");
    expect(card).not.toContain("PremiumPlanBadge");
  });

  it("stops importing the badge once nothing renders it", () => {
    expect(plans).not.toContain("PremiumPlanBadge");
  });

  it("keeps RSVP, which is the one status a guest list carries", () => {
    expect(detail).toContain("<RsvpBadge rsvp={attendee.rsvp}");
  });
});

describe("proximity treatment stays on proximity surfaces", () => {
  it("uses UserAvatar for attendees, never the Glow avatar", () => {
    expect(detail).toContain("<UserAvatar name={attendee.name}");
    expect(detail).not.toContain("GlowAvatar");
  });

  it("has no Glow avatar anywhere on the Plans page", () => {
    expect(plans).not.toContain("<GlowAvatar");
  });
});

describe("the heading describes what is under it", () => {
  it("does not promise 'going' above a list that includes invitees", () => {
    /* The list is `plan.attendees`, unfiltered, so a heading reading
       "Who's going (N)" was false the moment anyone was still `invited`. */
    expect(detail).toContain("plan.attendees.map");
    expect(detail).not.toContain("Who&apos;s going (");
  });

  it("names the section for the people and qualifies the count", () => {
    expect(detail).toContain('People ({plan.attendees.filter((a) => a.rsvp === "going").length} going)');
  });
});

describe("creating lands on the Plan", () => {
  const created = plans.slice(plans.indexOf("await createPlanAction"), plans.indexOf("const inviteCount"));

  it("opens the new Plan rather than a list containing it", () => {
    expect(created).toContain("if (result.planId) setSelectedPlanId(result.planId)");
  });

  it("still closes the composer and refreshes from the server", () => {
    expect(created).toContain("setCreateOpen(false)");
    expect(created).toContain("router.refresh()");
  });
});

describe("Plan Chat membership follows RSVP, by migration", () => {
  /* Kofi was invited to a real Plan and was correctly absent from its chat.
     That is the canonical rule, not a delivery bug -- assert it against the
     migration so a later change to the rule has to come here first. */
  const migration = readFileSync(
    "supabase/migrations/20260814200000_canonical_plan_lifecycle.sql",
    "utf8"
  );
  const reconcile = migration.slice(
    migration.indexOf("function public.reconcile_plan_conversation_members"),
    migration.indexOf("revoke all on function public.reconcile_plan_conversation_members")
  );

  it("admits only those who accepted", () => {
    expect(reconcile).toContain("pp.rsvp_status in ('going', 'maybe')");
  });

  it("still requires an unended friendship and no block", () => {
    expect(reconcile).toContain("f.ended_at is null");
    expect(reconcile).toContain("public.blocked_users");
  });
});
