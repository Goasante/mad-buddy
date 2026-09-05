/**
 * R2 final integrated smoke: the mutation journeys.
 *   settings visibility (D4 carry) -> profile edit -> messaging realtime
 *   -> outsider isolation -> UpFor create/end -> Safe Arrival happy path
 * Local only, harness only.
 */
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

const errs = { page: [], console: [], net: [] };
const loads = { qa: 0, kofi: 0 };
const browser = await chromium.launch({ headless: true });

async function open(tag, route) {
  const ctx = await browser.newContext({
    storageState: `C:/mb-profile-perf-p1/.d2/auth-${tag}.json`,
    viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true,
    baseURL: "http://127.0.0.1:3000", permissions: ["geolocation"],
    geolocation: { latitude: 5.6037, longitude: -0.1870 }
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.page.push(`${tag}: ${e.message.slice(0, 90)}`));
  p.on("console", (m) => { if (m.type() === "error") errs.console.push(`${tag}: ${m.text().slice(0, 90)}`); });
  p.on("requestfailed", (r) => errs.net.push({ t: tag, e: r.failure()?.errorText }));
  p.on("load", () => { if (loads[tag] !== undefined) loads[tag] += 1; });
  await p.goto(route, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3500);
  return { ctx, p };
}
const uid = async (username) => (await admin.from("profiles").select("user_id").eq("username", username).single()).data.user_id;
const QA = await uid("qatester"), KOFI = await uid("kofim"), AMA = await uid("amab");

/* ================= 1. SETTINGS / D4 CARRY ================= */
console.log("=== 1. SETTINGS visibility (D4 carry) ===");
const vBefore = (await admin.from("profiles").select("visibility_status").eq("user_id", QA).single()).data.visibility_status;
const S = await open("qa", "/settings/glow-visibility");
const body0 = await S.p.locator("body").innerText();
console.log("  surface:", body0.split("\n").filter(Boolean).slice(1, 4).join(" | ").slice(0, 110));
const options = await S.p.locator("button:visible, [role='radio']:visible").evaluateAll((e) =>
  e.map((x) => (x.textContent || "").trim().slice(0, 26)).filter(Boolean).slice(0, 8));
console.log("  controls:", JSON.stringify(options));
const target = S.p.locator("button:visible", { hasText: /Only my Muddies|Approved|Everyone|App open/i }).first();
if (await target.count()) {
  await target.click();
  await S.p.waitForTimeout(3500);
}
const vAfter = (await admin.from("profiles").select("visibility_status").eq("user_id", QA).single()).data.visibility_status;
console.log("  visibility:", vBefore, "->", vAfter, "| changed:", vBefore !== vAfter, "| 42501s:", errs.console.filter((e) => /42501/.test(e)).length);
const bodyV = await S.p.locator("body").innerText();
console.log("  error text on screen:", /could not be saved|went wrong/i.test(bodyV));

/* ================= 2. PROFILE EDIT ================= */
console.log("\n=== 2. PROFILE reversible edit ===");
const bioBefore = (await admin.from("profiles").select("bio").eq("user_id", QA).single()).data.bio;
const P = await open("qa", "/profile");
const marker = `smoke bio ${Date.now()}`;
const editBtn = P.p.getByRole("button", { name: /Edit profile|Edit/i }).first();
if (await editBtn.count()) { await editBtn.click(); await P.p.waitForTimeout(2000); }
const bioField = P.p.locator("textarea:visible").first();
if (await bioField.count()) {
  await bioField.fill(marker);
  const save = P.p.locator("button:visible", { hasText: /^Save/ }).first();
  if (await save.count()) { await save.click(); await P.p.waitForTimeout(4000); }
}
const bioMid = (await admin.from("profiles").select("bio").eq("user_id", QA).single()).data.bio;
console.log("  bio saved:", bioMid === marker, `(${String(bioMid).slice(0, 30)})`);
// revert through the same path
if (await bioField.count()) {
  await bioField.fill(bioBefore ?? "");
  const save2 = P.p.locator("button:visible", { hasText: /^Save/ }).first();
  if (await save2.count()) { await save2.click(); await P.p.waitForTimeout(4000); }
}
const bioAfter = (await admin.from("profiles").select("bio").eq("user_id", QA).single()).data.bio;
console.log("  reverted:", bioAfter === bioBefore, `(${String(bioAfter).slice(0, 30)})`);

/* ================= 3. MESSAGING REALTIME ================= */
console.log("\n=== 3. MESSAGING realtime ===");
const F = await open("qa", "/friends");
const msgBtn = F.p.locator("button:visible, a:visible", { hasText: /^Message$/ }).first();
await msgBtn.click();
await F.p.waitForTimeout(4000);
const convId = new URL(F.p.url()).searchParams.get("conversation");
console.log("  conversation:", convId);
const R = await open("kofi", `/messages?conversation=${convId}`);
const m1 = `smoke-a2b-${Date.now()}`;
const t0 = Date.now();
await F.p.locator("textarea,[contenteditable='true']").first().fill(m1);
await F.p.keyboard.press("Enter");
let bMs = null;
for (let i = 0; i < 40; i++) {
  if ((await R.p.locator("body").innerText()).includes(m1)) { bMs = Date.now() - t0; break; }
  await R.p.waitForTimeout(200);
}
await F.p.waitForTimeout(1500);
const { data: rows1 } = await admin.from("messages").select("id,client_message_id").eq("conversation_id", convId).eq("text_content", m1);
console.log("  A->B received:", bMs !== null, "| ms:", bMs, "| canonical rows:", (rows1 ?? []).length, "| cid:", Boolean(rows1?.[0]?.client_message_id));
const bText = await R.p.locator("body").innerText();
console.log("  copies on B:", bText.split(m1).length - 1);

const m2 = `smoke-b2a-${Date.now()}`;
const t1 = Date.now();
await R.p.locator("textarea,[contenteditable='true']").first().fill(m2);
await R.p.keyboard.press("Enter");
let aMs = null;
for (let i = 0; i < 40; i++) {
  if ((await F.p.locator("body").innerText()).includes(m2)) { aMs = Date.now() - t1; break; }
  await F.p.waitForTimeout(200);
}
await R.p.waitForTimeout(1200);
const { data: rows2 } = await admin.from("messages").select("id").eq("conversation_id", convId).eq("text_content", m2);
console.log("  B->A received:", aMs !== null, "| ms:", aMs, "| canonical rows:", (rows2 ?? []).length);
console.log("  document loads  qa:", loads.qa, "kofi:", loads.kofi, "(deliberate navigations only)");

/* ================= 4. OUTSIDER ISOLATION ================= */
console.log("\n=== 4. OUTSIDER isolation ===");
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const x = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anon, { auth: { persistSession: false } });
await x.auth.signInWithPassword({ email: "ama@local.test", password: "HardeningPass123!" });
const readConv = await x.from("conversations").select("id").eq("id", convId);
const readMsgs = await x.from("messages").select("id,text_content").eq("conversation_id", convId);
console.log("  X reads conversation:", readConv.error ? `DENIED ${readConv.error.code}` : `${(readConv.data ?? []).length} rows (expect 0)`);
console.log("  X reads messages    :", readMsgs.error ? `DENIED ${readMsgs.error.code}` : `${(readMsgs.data ?? []).length} rows (expect 0)`);
void AMA;

console.log("\n=== ERRORS SO FAR ===");
console.log("page:", errs.page.length, JSON.stringify(errs.page.slice(0, 2)));
console.log("console:", errs.console.length, JSON.stringify(errs.console.slice(0, 2)));
console.log("network non-aborted:", errs.net.filter((e) => !/ABORTED/.test(e.e || "")).length);
console.log(`CONV=${convId}`);
await browser.close();
