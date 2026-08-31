import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { resolveNotificationDestination } from "@/lib/notifications/destination";

/**
 * The Plan loop, end to end: invitation -> RSVP -> Plan Chat.
 *
 * The load-bearing rule here is that the Plan Chat door is opened by MEMBERSHIP
 * and nothing else. The RSVP rule ('going'/'maybe' + friendship + no block)
 * lives in the migration; the UI must not carry a second copy of it that can
 * drift, so it keys off a server-computed conversation id instead.
 */

const plansSource = readFileSync("components/plans/plans-page.tsx", "utf8");
const plans = stripComments(plansSource);
const service = stripComments(readFileSync("lib/plans/service.ts", "utf8"));
const planPage = stripComments(readFileSync("app/(app)/plans/page.tsx", "utf8"));
const migration = readFileSync("supabase/migrations/20260814200000_canonical_plan_lifecycle.sql", "utf8");

/* Tight slices: an earlier pass in this repo matched a bare word against a whole
 * file and passed on unrelated markup. Each rule below is scoped to the one
 * component or function that owns it. */
const detail = plans.slice(plans.indexOf("function PlanDetailsModal"), plans.indexOf("function AddPollForm"));
const changeRsvp = plans.slice(plans.indexOf("function changeRsvp"), plans.indexOf("function vote("));
const listBody = plans.slice(plans.indexOf("TOUR_TARGET_IDS.PLANS_LIST"), plans.indexOf("function rsvpPill"));

describe("a Plan invitation opens that Plan", () => {
  const ID = "5b6e3294-7386-437c-9ae1-1172a121ead7";

  it("deep-links to the exact Plan, not the index", () => {
    expect(resolveNotificationDestination(`plan:${ID}`)).toEqual({
      type: "internal",
      href: `/plans?plan=${ID}`
    });
  });

  it("falls back to the section when the id is not a real uuid", () => {
    // A deleted or malformed record must land somewhere valid, never crash.
    expect(resolveNotificationDestination("plan:not-a-uuid")).toEqual({ type: "internal", href: "/plans" });
    expect(resolveNotificationDestination("plan:https://evil.example")).toEqual({
      type: "internal",
      href: "/plans"
    });
  });

  it("leaves other notification types routing as they were", () => {
    expect(resolveNotificationDestination("friend_request_received")).toEqual({
      type: "internal",
      href: "/friends?tab=requests"
    });
    expect(resolveNotificationDestination("system_alert")).toBeNull();
  });

  it("opens the Plan named in ?plan= through the one detail component", () => {
    expect(plans).toContain('searchParams.get("plan")');
    expect(plans).toContain("<PlanDetailsModal");
    // One authority: the index card, the deep link and post-create all set the
    // same piece of state rather than routing three different ways.
    expect(plans).toContain("setSelectedPlanId");
  });
});

describe("Plan Chat is offered only to an actual member", () => {
  it("gates the CTA on a server-computed conversation id", () => {
    expect(detail).toContain("plan.myConversationId ?");
    expect(detail).toContain("Open Plan Chat");
  });

  it("does not re-derive the RSVP rule in the client", () => {
    // The moment the UI starts asking "is my rsvp going or maybe?" it owns a
    // second copy of a rule the migration already enforces.
    const cta = detail.slice(detail.indexOf("myConversationId ?"), detail.indexOf("plan.polls.map"));
    expect(cta).not.toContain('"going"');
    expect(cta).not.toContain('"maybe"');
  });

  it("routes to the Plan conversation, never a DM", () => {
    expect(plans).toContain("/messages?conversation=${encodeURIComponent(conversationId)}");
    // A DM would be opened by user id; the Plan has one conversation.
    expect(detail).not.toContain("openDirectConversation");
  });

  it("only fills the id in for a joined member, server-side", () => {
    // Both projections must gate identically: the Plans page and the shared
    // service each build PlanSummary independently.
    for (const source of [service, planPage]) {
      expect(source).toContain('.eq("context_type", "plan")');
      expect(source).toContain('.eq("status", "joined")');
      expect(source).toContain("myConversationByPlan");
    }
  });

  it("keeps membership itself keyed to RSVP in the migration", () => {
    const reconcile = migration.slice(
      migration.indexOf("function public.reconcile_plan_conversation_members"),
      migration.indexOf("revoke all on function public.reconcile_plan_conversation_members")
    );
    expect(reconcile).toContain("pp.rsvp_status in ('going', 'maybe')");
    expect(reconcile).toContain("f.ended_at is null");
    expect(reconcile).toContain("public.blocked_users");
  });

  it("reconciles inside the RSVP transaction, so access is never promised early", () => {
    const rpc = migration.slice(migration.indexOf("function public.set_plan_participant_rsvp"));
    expect(rpc).toContain("public.reconcile_plan_conversation_members(p_plan_id)");
  });
});

describe("a refused RSVP does not look accepted", () => {
  it("captures the previous answer before painting optimistically", () => {
    expect(changeRsvp).toContain("const previousRsvp = plans.find");
  });

  it("restores it when the server says no", () => {
    expect(changeRsvp).toContain("if (!result.ok && previousRsvp !== undefined)");
  });

  it("restores it when the action throws", () => {
    expect(changeRsvp).toContain("} catch {");
    expect(changeRsvp).toContain("Couldn't save your RSVP.");
  });

  it("still refreshes for authoritative counts and the chat door", () => {
    expect(changeRsvp).toContain("router.refresh()");
  });
});

describe("RSVP controls belong to the invitee", () => {
  it("hides them from the host and on terminal plans", () => {
    expect(detail).toContain("{!plan.isHost && !TERMINAL.has(plan.status) ?");
  });

  it("names a fresh invitation as an invitation", () => {
    expect(detail).toContain('"You\'re invited" : "Your RSVP"');
  });

  it("offers the three canonical answers", () => {
    expect(detail).toContain('onRsvpChange("going")');
    expect(detail).toContain('onRsvpChange("maybe")');
    expect(detail).toContain('onRsvpChange("not_going")');
  });
});

describe("the end of a list is not an empty state", () => {
  it("closes a populated list with one quiet line", () => {
    expect(listBody).toContain("listEndCopy[activeBucket].title");
  });

  it("gives it no card, border, or icon", () => {
    const endMarker = listBody.slice(listBody.indexOf("listEndCopy[activeBucket].title") - 220);
    expect(endMarker).not.toContain("rounded-2xl border");
    expect(endMarker.slice(0, 240)).not.toContain("CalendarDays");
  });

  it("keeps a real empty state for a genuinely empty tab", () => {
    expect(listBody).toContain("emptyCopy[activeBucket].title");
  });
});

describe("the tab strip scrolls rather than truncating", () => {
  it("keeps every label whole and reachable", () => {
    expect(plans).toContain("overflow-x-auto");
    expect(plans).toContain("w-max");
    expect(plans).toContain("whitespace-nowrap");
    expect(plans).toContain("shrink-0");
  });

  it("signals that it scrolls", () => {
    expect(plans).toContain("plans-tab-strip");
    expect(readFileSync("app/globals.css", "utf8")).toContain(".plans-tab-strip");
  });
});
