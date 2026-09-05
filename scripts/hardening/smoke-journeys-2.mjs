/** R2 final smoke part 2: UpFor create/end and Safe Arrival happy path. Local only. */
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
const QA = (await admin.from("profiles").select("user_id").eq("username", "qatester").single()).data.user_id;
const KOFI = (await admin.from("profiles").select("user_id").eq("username", "kofim").single()).data.user_id;

/* ================= UPFOR ================= */
console.log("=== UPFOR create / end ===");
const before = (await admin.from("hangout_sessions").select("id", { count: "exact", head: true }).eq("owner_id", QA)).count;
const U = await open("qa", "/hangout-mode");
const btns = await U.p.locator("button:visible").evaluateAll((e) => e.map((x) => (x.textContent || "").trim().slice(0, 24)).filter(Boolean).slice(0, 12));
console.log("  controls:", JSON.stringify(btns));
const start = U.p.locator("button:visible", { hasText: /I'm up for|Start|Create|Quick Ideas|Set up/i }).first();
console.log("  start control:", await start.count(), await start.count() ? (await start.textContent()).trim().slice(0, 22) : "");
if (await start.count()) { await start.click(); await U.p.waitForTimeout(3000); }
const dlgText = await U.p.locator("[role='dialog']").innerText().catch(() => "(no dialog)");
console.log("  sheet:", dlgText.split(String.fromCharCode(10)).filter(Boolean).slice(0, 6).join(" | ").slice(0, 200));
const dlgBtns = await U.p.locator("[role='dialog'] button:visible").evaluateAll((e) => e.map((x) => ({ t: (x.textContent || "").trim().slice(0, 22), d: x.disabled })).filter((x) => x.t));
console.log("  sheet buttons:", JSON.stringify(dlgBtns.slice(0, 10)));
// Complete the sheet: activity -> audience -> confirm.
const dlg = U.p.locator("[role='dialog']");
await dlg.locator("button", { hasText: /^Food$/ }).first().click();
await U.p.waitForTimeout(700);
const aud = dlg.locator("button", { hasText: /Muddies only/i }).first();
if (await aud.count()) { await aud.click(); await U.p.waitForTimeout(700); }
const all2 = await dlg.locator("button:visible").evaluateAll((e) => e.map((x) => ({ t: (x.textContent || "").trim().slice(0, 26), d: x.disabled })).filter((x) => x.t));
console.log("  after choices:", JSON.stringify(all2.slice(-6)));
const go = dlg.locator("button", { hasText: /Start|Go|Post|Share|Confirm|Done/i }).last();
if (await go.count()) { console.log("  confirming with:", (await go.textContent()).trim().slice(0, 22)); await go.click(); await U.p.waitForTimeout(5000); }

const after = (await admin.from("hangout_sessions").select("id,activity_type,status", { count: "exact" }).eq("owner_id", QA));
console.log("  sessions:", before, "->", after.count);
console.log("  rows:", JSON.stringify((after.data ?? []).map((r) => `${r.activity_type}:${r.status}`)));

console.log("\n=== ERRORS ===");
console.log("page:", errs.page.length, "| console:", errs.console.length, "| loads:", loads);
console.log(`QA=${QA} KOFI=${KOFI}`);
await browser.close();
