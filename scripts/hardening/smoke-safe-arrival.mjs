/** R2 final smoke: Safe Arrival happy path (start -> accept -> arrive). Local only. */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync("C:/mb-profile-perf-p1/.env.local", "utf8").split(/\r?\n/)) {
  const s = l.trim(); if (!s || s.startsWith("#")) continue;
  const i = s.indexOf("="); if (i > 0) env[s.slice(0, i)] = s.slice(i + 1);
}
if (!/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) { console.error("HARD STOP"); process.exit(1); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const errs = { page: [], console: [] };
let loads = 0;
const browser = await chromium.launch({ headless: true });
async function open(tag, route) {
  const ctx = await browser.newContext({
    storageState: `C:/mb-profile-perf-p1/.d2/auth-${tag}.json`,
    viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true,
    baseURL: "http://127.0.0.1:3000", permissions: ["geolocation"],
    geolocation: { latitude: 5.6037, longitude: -0.1870 }
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.page.push(`${tag}: ${e.message.slice(0, 80)}`));
  p.on("console", (m) => { if (m.type() === "error") errs.console.push(`${tag}: ${m.text().slice(0, 80)}`); });
  p.on("load", () => loads += 1);
  await p.goto(route, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  return { ctx, p };
}
const counts = async () => ({
  sessions: (await admin.from("safe_arrival_sessions").select("id", { count: "exact", head: true })).count,
  contacts: (await admin.from("safe_arrival_contacts").select("id", { count: "exact", head: true })).count,
  events: (await admin.from("safe_arrival_events").select("id", { count: "exact", head: true })).count
});

const before = await counts();
console.log("=== SAFE ARRIVAL happy path ===");
console.log("baseline:", JSON.stringify(before));

/* ---- traveller starts ---- */
const T = await open("qa", "/safe-arrival");
await T.p.getByRole("button", { name: /Start Safe Arrival/i }).first().click();
await T.p.waitForTimeout(2500);
const dlg = T.p.locator("[role='dialog']");
await dlg.locator("input").first().fill("Final smoke destination");
const t = new Date(Date.now() + 2 * 3600 * 1000);
const pad = (n) => String(n).padStart(2, "0");
await dlg.locator("input[type='time']").first().fill(`${pad(t.getHours())}:${pad(t.getMinutes())}`);
await T.p.waitForTimeout(600);
await dlg.locator("button", { hasText: "30 min" }).first().click();
await T.p.waitForTimeout(600);
await dlg.locator("button", { hasText: "Next: Choose Contacts" }).first().click();
await T.p.waitForTimeout(2500);
await dlg.locator("button", { hasText: "Kofi Mensah" }).first().click();
await T.p.waitForTimeout(700);
await dlg.locator("button", { hasText: "Next: Review" }).first().click();
await T.p.waitForTimeout(2200);
const review = await dlg.innerText();
console.log("review privacy line:", /No live location is shared/i.test(review));
await dlg.locator("button", { hasText: /^Start Safe Arrival$/i }).last().click();
await T.p.waitForTimeout(6000);

const { data: session } = await admin.from("safe_arrival_sessions").select("id,status,destination_label").order("created_at", { ascending: false }).limit(1);
const SID = session?.[0]?.id;
const afterStart = await counts();
console.log("START  session:", JSON.stringify(session?.[0]), "| deltas: sessions +" + (afterStart.sessions - before.sessions), "contacts +" + (afterStart.contacts - before.contacts));
const tText = await T.p.locator("body").innerText();
console.log("       traveller sees journey:", /IN TRANSIT|Arriving by/i.test(tText), "| live-location claim:", /live location|your location is being shared/i.test(tText));

/* ---- watcher accepts ---- */
const W = await open("kofi", "/dashboard");
const ack = W.p.locator("button:visible", { hasText: /Count me in/i }).first();
console.log("ACCEPT control:", await ack.count());
if (await ack.count()) { await ack.click(); await W.p.waitForTimeout(4500); }
const contact = (await admin.from("safe_arrival_contacts").select("acknowledgement_status").eq("session_id", SID).maybeSingle()).data;
console.log("       contact:", JSON.stringify(contact));

/* ---- traveller reconciles ---- */
await T.p.reload({ waitUntil: "domcontentloaded" });
await T.p.waitForTimeout(4000);
const tText2 = await T.p.locator("body").innerText();
console.log("RECONCILE traveller sees confirmed:", /1 confirmed|confirmed/i.test(tText2));

/* ---- arrive ---- */
const arrive = T.p.locator("button:visible", { hasText: /I've arrived/i }).first();
console.log("ARRIVE control:", await arrive.count());
if (await arrive.count()) {
  await arrive.click();
  await T.p.waitForTimeout(3000);
  const confirm = T.p.locator("[role='dialog'] button:visible", { hasText: /arrived|confirm|yes/i }).last();
  if (await confirm.count()) { await confirm.click(); await T.p.waitForTimeout(5000); }
}
const final = (await admin.from("safe_arrival_sessions").select("status,confirmed_at").eq("id", SID).maybeSingle()).data;
const afterAll = await counts();
console.log("       final status:", JSON.stringify(final));
console.log("DB TRUTH sessions +", afterAll.sessions - before.sessions, "| contacts +", afterAll.contacts - before.contacts, "| events +", afterAll.events - before.events);
const { data: evs } = await admin.from("safe_arrival_events").select("event_type").eq("session_id", SID).order("created_at");
console.log("         event trail:", JSON.stringify((evs ?? []).map((e) => e.event_type)));
console.log("\nERRORS page:", errs.page.length, "| console:", errs.console.length, "| loads:", loads);
console.log(`SID=${SID}`);
await browser.close();
