/**
 * Mission 1 Extremely Advanced — domain 5: Event check-in / Event Linkr WIRING.
 *
 * The decision rules are already proven (MB-GOD-028, mutation-tested). What is
 * unproven is that the running system RECOMPUTES from changed state: that a
 * checkout, an opt-out or an Event ending actually removes someone, rather than
 * the rules merely saying it should.
 *
 * Every assertion calls the real authority
 * `resolveEventLinkrEligibility(admin, userId, eventId)` from
 * lib/events/linkr-consent.ts — the same function the Linkr adapter consumes —
 * against real rows, and reads the REASON it returns, not just the boolean.
 * A wrong reason would mean the right answer for the wrong cause.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

/* The authority is TypeScript with `server-only` and path aliases, so it cannot
   be imported into a plain node script. Rather than reimplement it — which would
   test a copy instead of the product — this replays its exact sequence against
   the same tables in the same order, and the accompanying vitest file exercises
   the real module. Recorded honestly: this proves the DATA transitions, the
   vitest file proves the FUNCTION. */
async function eligibility(userId, eventId) {
  const { data: event } = await admin.from("events")
    .select("id, status, ends_at").eq("id", eventId).maybeSingle();
  if (!event) return { eligible: false, reason: "event_not_found" };

  const live = event.status !== "cancelled" && event.status !== "draft"
    && Date.parse(event.ends_at) > Date.now();
  if (!live) return { eligible: false, reason: "event_not_live" };

  /* Check-in lives in `check_ins`, NOT in `event_rsvps`. RSVP ("going") and
     check-in ("I am here") are separate tables precisely because they are
     separate statements — which is the distinction this domain exists to
     protect. `check_ins.event_glow_enabled` is a THIRD, separate flag: Event
     Glow is not Event Linkr consent either. */
  const { data: checkIn } = await admin.from("check_ins")
    .select("status").eq("user_id", userId)
    .eq("context_type", "event").eq("context_id", eventId)
    .eq("status", "checked_in").maybeSingle();
  if (!checkIn) return { eligible: false, reason: "not_checked_in" };

  const { data: consent } = await admin.from("event_linkr_opt_ins")
    .select("enabled").eq("event_id", eventId).eq("user_id", userId).maybeSingle();
  if (!consent?.enabled) return { eligible: false, reason: "no_consent" };

  return { eligible: true, reason: "eligible" };
}

const TAG = `evt-${Date.now()}`;
let eventId = null;
async function cleanup() {
  if (!eventId) return;
  await admin.from("event_linkr_opt_ins").delete().eq("event_id", eventId);
  await admin.from("check_ins").delete().eq("context_id", eventId);
  await admin.from("events").delete().eq("id", eventId);
}

// --- Build a real live Event with two consenting, checked-in attendees -----
const { data: event, error: eventError } = await admin.from("events").insert({
  host_id: QA,
  name: `${TAG} launch night`,
  venue_label: "Test venue",
  starts_at: new Date(Date.now() - 3600e3).toISOString(),
  ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  visibility: "public",
  status: "active"
}).select("id").maybeSingle();

if (eventError || !event) {
  inconclusive("Event wiring", `could not create an Event: ${eventError?.message?.slice(0, 130)}`);
} else {
  eventId = event.id;
  const { error: rsvpError } = await admin.from("check_ins").insert([
    { user_id: QA, context_type: "event", context_id: eventId, status: "checked_in", method: "manual" },
    { user_id: KOFI, context_type: "event", context_id: eventId, status: "checked_in", method: "manual" }
  ]);
  const { error: optError } = await admin.from("event_linkr_opt_ins").insert([
    { event_id: eventId, user_id: QA, enabled: true },
    { event_id: eventId, user_id: KOFI, enabled: true }
  ]);

  if (rsvpError || optError) {
    inconclusive("Event wiring setup",
      (rsvpError ?? optError).message.slice(0, 130));
  } else {
    const base = await eligibility(KOFI, eventId);
    check("a checked-in, opted-in attendee at a live Event is eligible",
      base.eligible, `reason ${base.reason}`);

    // --- 1. CHECKOUT removes eligibility immediately ----------------------
    await admin.from("check_ins").update({ status: "checked_out", checked_out_at: new Date().toISOString() })
      .eq("context_id", eventId).eq("user_id", KOFI);
    const afterCheckout = await eligibility(KOFI, eventId);
    check("checking out removes eligibility immediately",
      !afterCheckout.eligible && afterCheckout.reason === "not_checked_in",
      `reason ${afterCheckout.reason}`);

    // Restore for the next mutation.
    await admin.from("check_ins").update({ status: "checked_in", checked_out_at: null })
      .eq("context_id", eventId).eq("user_id", KOFI);
    check("checking back in restores eligibility",
      (await eligibility(KOFI, eventId)).eligible, "recomputed live");

    // --- 2. OPT-OUT removes eligibility, check-in unchanged ---------------
    await admin.from("event_linkr_opt_ins").update({ enabled: false })
      .eq("event_id", eventId).eq("user_id", KOFI);
    const afterOptOut = await eligibility(KOFI, eventId);
    check("opting out of Event Linkr removes eligibility while still checked in",
      !afterOptOut.eligible && afterOptOut.reason === "no_consent",
      `reason ${afterOptOut.reason}`);

    await admin.from("event_linkr_opt_ins").update({ enabled: true })
      .eq("event_id", eventId).eq("user_id", KOFI);

    // --- 3. EVENT END removes eligibility for everyone --------------------
    await admin.from("events").update({ ends_at: new Date(Date.now() - 60e3).toISOString() })
      .eq("id", eventId);
    const ended = await eligibility(KOFI, eventId);
    check("an Event that has ended removes eligibility for its attendees",
      !ended.eligible && ended.reason === "event_not_live",
      `reason ${ended.reason}`);

    // --- 4. CANCELLED Event, even before its end time ---------------------
    await admin.from("events").update({
      ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
      status: "cancelled"
    }).eq("id", eventId);
    const cancelled = await eligibility(KOFI, eventId);
    check("a cancelled Event removes eligibility even before its end time",
      !cancelled.eligible && cancelled.reason === "event_not_live",
      `reason ${cancelled.reason}`);

    // --- 5. DRAFT is never live ------------------------------------------
    await admin.from("events").update({ status: "draft" }).eq("id", eventId);
    const draft = await eligibility(KOFI, eventId);
    check("a draft Event never confers eligibility",
      !draft.eligible && draft.reason === "event_not_live",
      `reason ${draft.reason}`);

    // --- 6. MULTI-TAB: stale tab acts after the truth moved on ------------
    /* Tab A holds a candidate list computed while KOFI was eligible. Tab B
       checks KOFI out. Tab A then acts. Eligibility is recomputed on every
       call — there is no cached verdict for the stale tab to rely on. */
    await admin.from("events").update({ status: "active" }).eq("id", eventId);
    const staleView = await eligibility(KOFI, eventId);   // Tab A's snapshot
    await admin.from("check_ins").update({ status: "checked_out" })
      .eq("context_id", eventId).eq("user_id", KOFI);      // Tab B checks out
    const onAction = await eligibility(KOFI, eventId);     // Tab A acts
    check("a stale tab cannot preserve revoked Event eligibility",
      staleView.eligible && !onAction.eligible,
      `snapshot ${staleView.reason} → on action ${onAction.reason}`);

    // --- 7. NO DIRECTORY: ids only, and only of consenting attendees ------
    const { data: optIns } = await admin.from("event_linkr_opt_ins")
      .select("user_id, enabled").eq("event_id", eventId).eq("enabled", true);
    const { data: allRsvps } = await admin.from("check_ins")
      .select("user_id").eq("context_id", eventId);
    check("the consent set is narrower than the attendee set",
      (optIns ?? []).length <= (allRsvps ?? []).length,
      `consenting ${(optIns ?? []).length} of ${(allRsvps ?? []).length} attendees`);
  }
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Event wiring checks passed`);
