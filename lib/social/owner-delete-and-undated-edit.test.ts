import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const planActions = read("app/(app)/plans-actions.ts");
const plansPage = read("components/plans/plans-page.tsx");
const eventActions = read("app/(app)/event-actions.ts");
const eventsPage = read("components/events/events-page.tsx");
const hostTools = read("components/events/event-host-tools.tsx");
const migration = read("supabase/migrations/20260929090000_owner_delete_plan_event.sql");

describe("owner deletion is distinct from lifecycle cancellation/end", () => {
  it("keeps Plan cancellation and permanent deletion as separate server actions", () => {
    expect(planActions).toContain("export async function cancelPlanAction");
    expect(planActions).toContain("export async function deletePlanAction");
    expect(planActions).toContain('admin.rpc("delete_owned_plan"');
    expect(planActions).toContain("Only the host can delete this plan.");
  });

  it("keeps Event ending and permanent deletion as separate server actions", () => {
    expect(eventActions).toContain("export async function endEventAction");
    expect(eventActions).toContain("export async function deleteEventAction");
    expect(eventActions).toContain('admin.rpc("delete_owned_event"');
    expect(eventActions).toContain("Only the host can delete this event.");
  });
});

describe("undated Plans can be dated without recreating them", () => {
  it("exposes one host-only action that only fills an empty start_at", () => {
    const action = planActions.slice(
      planActions.indexOf("export async function setPlanDateAction"),
      planActions.indexOf("// Permanently delete a Plan")
    );
    expect(action).toContain("Only the host can change this plan.");
    expect(action).toContain(".is(\"start_at\", null)");
    expect(action).toContain("Choose a date and time in the future.");
    expect(action).toContain('plan.plan_type === "quick"');
    expect(action).toContain('update.plan_type = "scheduled"');
  });

  it("shows the editor only for an undated non-terminal Plan owned by the viewer", () => {
    expect(plansPage).toContain(
      "plan.isHost && !plan.startAt && !TERMINAL.has(plan.status)"
    );
    expect(plansPage).toContain("<PlanDateEditor pending={pending} onSave={onSetDate} />");
    expect(plansPage).toContain('setActiveBucket("hosting")');
    expect(plansPage).toContain("setPlanDateAction({ planId, startAt })");
  });
});

describe("past Plans and ended Events stay deletable", () => {
  it("renders Plan deletion outside the non-terminal host controls", () => {
    const detail = plansPage.slice(
      plansPage.indexOf("function PlanDetailsModal"),
      plansPage.indexOf("function PlanDateEditor")
    );
    expect(detail).toContain("plan.isHost && !TERMINAL.has(plan.status)");
    expect(detail).toContain("{plan.isHost ? (");
    expect(detail).toContain("Delete plan");
    expect(detail).toContain("permanently removed for everyone");
  });

  it("renders Event deletion independently of the End Event state", () => {
    expect(hostTools).toContain("const [confirmDelete, setConfirmDelete]");
    expect(hostTools).toContain("onDeleteEvent");
    expect(hostTools).toContain("Delete Event");
    expect(hostTools).toContain("Rooms and their chats will be permanently removed");
  });

  it("removes a deleted Event locally and clears its deep link", () => {
    expect(eventsPage).toContain("const result = await deleteEventAction(eventId)");
    expect(eventsPage).toContain(
      "setEvents((current) => current.filter((event) => event.id !== eventId))"
    );
    expect(eventsPage).toContain("setSelectedId(null)");
    expect(eventsPage).toContain('router.replace("/events")');
  });
});

describe("deletion transactions clean generic-context data atomically", () => {
  it("removes Plan chat/check-in/drop references before deleting the Plan", () => {
    const fn = migration.slice(
      migration.indexOf("function public.delete_owned_plan"),
      migration.indexOf("function public.delete_owned_event")
    );
    expect(fn).toContain("PLAN_DELETE_FORBIDDEN");
    expect(fn).toContain("delete from public.check_ins");
    expect(fn).toContain("delete from public.muddy_drops");
    expect(fn).toContain("delete from public.conversations");
    expect(fn).toContain("delete from public.plans");
    expect(fn).toContain("public.media_deletion_queue");
  });

  it("removes Event and Room conversations plus generic Event references", () => {
    const fn = migration.slice(migration.indexOf("function public.delete_owned_event"));
    expect(fn).toContain("EVENT_DELETE_FORBIDDEN");
    expect(fn).toContain("public.event_circles");
    expect(fn).toContain("context_type = 'event_circle'");
    expect(fn).toContain("delete from public.check_ins");
    expect(fn).toContain("delete from public.invite_links");
    expect(fn).toContain("delete from public.conversations");
    expect(fn).toContain("delete from public.events");
    expect(fn).toContain("public.media_deletion_queue");
  });

  it("does not expose either destructive RPC to browser roles", () => {
    expect(migration).toContain(
      "revoke all on function public.delete_owned_plan(uuid, uuid) from public, anon, authenticated"
    );
    expect(migration).toContain(
      "revoke all on function public.delete_owned_event(uuid, uuid) from public, anon, authenticated"
    );
    expect(migration).toContain(
      "grant execute on function public.delete_owned_plan(uuid, uuid) to service_role"
    );
    expect(migration).toContain(
      "grant execute on function public.delete_owned_event(uuid, uuid) to service_role"
    );
  });
});
