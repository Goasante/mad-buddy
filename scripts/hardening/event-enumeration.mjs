/**
 * God Mode / security — live attendee-enumeration attack on Events.
 *
 * The DATA contract is already proven: `eventLinkrCandidateIds` returns ids
 * only, and only of consenting attendees. What was never run is the network
 * attack — what an actual HTTP response hands to an actual viewer.
 *
 * "The UI does not show it" is not privacy proof. This reads the payloads.
 *
 * Seeded so a leak would be VISIBLE: several attendees in mixed states
 * (checked in + consenting, checked in without consent, going but not checked
 * in), because an empty attendee list cannot demonstrate the absence of a
 * directory.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";   // host
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a"; // checked in + consenting
const AMA = "b66cd360-1f24-4b02-9b8c-123b522d0c61";  // checked in, NO consent
const JOJO = "11abd0ec-5ae6-4a6a-8b74-3806b8a47bb2"; // going, not checked in
// The unrelated attacker signs in as saa@local.test below; their id is not
// needed here because the attack looks for the ATTENDEES' ids, not their own.

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const TAG = `enum-${Date.now()}`;
let eventId = null;

async function cleanup() {
  if (!eventId) return;
  await admin.from("event_linkr_opt_ins").delete().eq("event_id", eventId);
  await admin.from("check_ins").delete().eq("context_id", eventId);
  await admin.from("event_rsvps").delete().eq("event_id", eventId);
  await admin.from("events").delete().eq("id", eventId);
}
await cleanup();

// --- Seed a live Event with attendees in DIFFERENT states -----------------
const { data: event, error } = await admin.from("events").insert({
  host_id: QA,
  name: `${TAG} enumeration probe`,
  venue_label: "Test venue",
  starts_at: new Date(Date.now() - 3600e3).toISOString(),
  ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
  visibility: "public",
  status: "active"
}).select("id").maybeSingle();

if (error || !event) {
  console.log(`INCONC  event enumeration — could not seed: ${error?.message?.slice(0, 120)}`);
} else {
  eventId = event.id;
  await admin.from("event_rsvps").insert([
    { event_id: eventId, user_id: KOFI, status: "going" },
    { event_id: eventId, user_id: AMA, status: "going" },
    { event_id: eventId, user_id: JOJO, status: "going" }
  ]);
  await admin.from("check_ins").insert([
    { user_id: KOFI, context_type: "event", context_id: eventId, status: "checked_in", method: "manual" },
    { user_id: AMA, context_type: "event", context_id: eventId, status: "checked_in", method: "manual" }
  ]);
  await admin.from("event_linkr_opt_ins").insert([
    { event_id: eventId, user_id: KOFI, enabled: true },
    { event_id: eventId, user_id: AMA, enabled: false }
  ]);

  // The identifiers a leak would expose. If any appears in a payload for a
  // viewer who should not have it, that is a directory leak.
  const SECRETS = {
    [KOFI]: "KOFI (checked in + consenting)",
    [AMA]: "AMA (checked in, NO consent)",
    [JOJO]: "JOJO (going, not checked in)"
  };

  const browser = await chromium.launch();

  /** Collects every HTTP response body a viewer receives on the Event routes. */
  async function harvest(label, storageState) {
    const ctx = await browser.newContext(storageState ? { storageState } : {});
    const page = await ctx.newPage();
    const bodies = [];
    page.on("response", async (r) => {
      const url = r.url();
      if (!url.startsWith(BASE)) return;
      try {
        const body = await r.text();
        bodies.push({ url: url.replace(BASE, ""), body });
      } catch { /* streamed or binary */ }
    });

    for (const route of [`/events?event=${eventId}`, `/events/${eventId}`, `/events`]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2200);
    }
    // Also ask the API surfaces directly, as a client could.
    const direct = await page.evaluate(async (id) => {
      const out = [];
      for (const path of [`/api/events/${id}`, `/api/events/${id}/attendees`, `/api/events?event=${id}`]) {
        try {
          const r = await fetch(path, { headers: { accept: "application/json" } });
          out.push({ path, status: r.status, body: (await r.text()).slice(0, 4000) });
        } catch { /* ignore */ }
      }
      return out;
    }, eventId).catch(() => []);
    for (const d of direct) bodies.push({ url: `${d.path} (${d.status})`, body: d.body });

    await ctx.close();

    const leaks = [];
    for (const { url, body } of bodies) {
      for (const [id, who] of Object.entries(SECRETS)) {
        if (body.includes(id)) leaks.push(`${who} in ${url}`);
      }
    }
    return { label, payloads: bodies.length, leaks: [...new Set(leaks)] };
  }

  // The host legitimately manages the Event, so their own view is not the
  // attack — the question is what everyone ELSE receives.
  const asHost = await harvest("host", "C:/mb-god/.hardening/auth-prod.json");
  check("the probe actually captured payloads (not an empty run)",
    asHost.payloads > 0, `host saw ${asHost.payloads} payloads`);

  const asAnon = await harvest("signed out", null);
  check("a signed-out visitor receives NO attendee identifiers",
    asAnon.leaks.length === 0,
    asAnon.leaks.length ? asAnon.leaks.join(" | ") : `${asAnon.payloads} payloads, none leaked`);

  // An unrelated authenticated user: the most realistic attacker.
  const outsiderCtx = await browser.newContext();
  const outsiderPage = await outsiderCtx.newPage();
  await outsiderPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await outsiderPage.waitForTimeout(3500);
  await outsiderPage.fill('input[type="email"]', "saa@local.test");
  await outsiderPage.fill('input[type="password"]', "HardeningPass123!");
  await outsiderPage.locator('button[type="submit"]').first().click();
  await outsiderPage.waitForTimeout(6000);
  const outsiderState = `C:/mb-god/.hardening/auth-outsider.json`;
  await outsiderCtx.storageState({ path: outsiderState });
  await outsiderCtx.close();

  const asOutsider = await harvest("unrelated user", outsiderState);
  check("an unrelated authenticated user receives NO attendee identifiers",
    asOutsider.leaks.length === 0,
    asOutsider.leaks.length ? asOutsider.leaks.join(" | ") : `${asOutsider.payloads} payloads, none leaked`);

  // The sharpest question: does a non-consenting attendee leak to anyone?
  const nonConsentingLeaks = [...asAnon.leaks, ...asOutsider.leaks].filter((l) => l.startsWith("AMA"));
  check("the attendee who did NOT consent never appears in any viewer payload",
    nonConsentingLeaks.length === 0,
    nonConsentingLeaks.length ? nonConsentingLeaks.join(" | ") : "absent everywhere");

  await browser.close();
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} enumeration checks passed`);
