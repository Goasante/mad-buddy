/** D6: profile edit through the real UI, plus the D4 security carry. Local only. */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = {};
for (const l of readFileSync("C:/mb-profile-perf-p1/.env.local", "utf8").split(/\r?\n/)) {
  const s = l.trim(); if (!s || s.startsWith("#")) continue;
  const i = s.indexOf("="); if (i > 0) env[s.slice(0, i)] = s.slice(i + 1);
}
if (!/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) { console.error("HARD STOP"); process.exit(1); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const VW = Number(process.env.VW || 393), VH = Number(process.env.VH || 852);
const THEME = process.env.THEME || "light";

const QA = (await admin.from("profiles").select("user_id").eq("username", "qatester").single()).data.user_id;
const KOFI = (await admin.from("profiles").select("user_id").eq("username", "kofim").single()).data.user_id;
const cols = "bio,full_name,mood_status,username,user_id,is_onboarded,deleted_at,trusted_member_since,created_at";
const snapshot = async (id) => (await admin.from("profiles").select(cols).eq("user_id", id).single()).data;

const errs = { page: [], console: [] };
let loads = 0;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  storageState: "C:/mb-profile-perf-p1/.d2/auth-qa.json",
  viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true,
  baseURL: "http://127.0.0.1:3000", colorScheme: THEME
});
const p = await ctx.newPage();
p.on("pageerror", (e) => errs.page.push(e.message.slice(0, 90)));
p.on("console", (m) => { if (m.type() === "error") errs.console.push(m.text().slice(0, 90)); });
p.on("load", () => loads += 1);

const before = await snapshot(QA);
console.log(`=== D6 PROFILE EDIT  ${VW}x${VH} ${THEME} ===`);
console.log("BEFORE bio:", JSON.stringify(before.bio), "| name:", before.full_name, "| mood:", before.mood_status);

/* ---------- edit through the real UI ---------- */
await p.goto("/profile", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3500);
await p.getByRole("button", { name: /Edit profile|Edit/i }).first().click();
await p.waitForTimeout(2200);
const marker = `D6 bio ${Date.now()}`;
const bio = p.locator("textarea:visible").first();
await bio.click();
await bio.press("Control+a");
await bio.type(marker, { delay: 15 });
await p.waitForTimeout(600);
const save = p.locator("button:visible", { hasText: /Save profile/i }).first();
const saveBox = await save.boundingBox();
await save.click();
await p.waitForTimeout(5500);
const afterSave = await snapshot(QA);
const feedback = (await p.locator("body").innerText()).split("\n").filter((l) => /saved|updated|could not|error|try again/i.test(l)).slice(0, 3);
console.log("SAVE  bio applied:", afterSave.bio === marker, "| feedback:", JSON.stringify(feedback));
console.log("      42501 in console:", errs.console.filter((e) => /42501/.test(e)).length);
console.log("      other fields unchanged: name", afterSave.full_name === before.full_name,
  "| username", afterSave.username === before.username, "| mood", afterSave.mood_status === before.mood_status);
console.log("      PROTECTED unchanged: is_onboarded", afterSave.is_onboarded === before.is_onboarded,
  "| deleted_at", String(afterSave.deleted_at) === String(before.deleted_at),
  "| trusted_member_since", String(afterSave.trusted_member_since) === String(before.trusted_member_since),
  "| created_at", String(afterSave.created_at) === String(before.created_at),
  "| user_id", afterSave.user_id === before.user_id);

/* ---------- multi-field edit ---------- */
// The sheet closes on a successful save, so each edit reopens it.
const reopen = async () => {
  const btn = p.getByRole("button", { name: /Edit profile|Edit/i }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(2200); }
};
await reopen();
const mood = p.locator("input[placeholder='What is your mood?']").first();
if (await mood.count()) {
  await mood.click(); await mood.press("Control+a"); await mood.type("D6 mood", { delay: 15 });
  await p.locator("button:visible", { hasText: /Save profile/i }).first().click();
  await p.waitForTimeout(5000);
}
const afterMulti = await snapshot(QA);
console.log("MULTI mood applied:", afterMulti.mood_status === "D6 mood", "| bio still marker:", afterMulti.bio === marker);

/* ---------- restore through the same UI ---------- */
await reopen();
const bio2 = p.locator("textarea:visible").first();
await bio2.click(); await bio2.press("Control+a"); await bio2.type(before.bio ?? "", { delay: 10 });
const mood2 = p.locator("input[placeholder='What is your mood?']").first();
if (await mood2.count()) { await mood2.click(); await mood2.press("Control+a"); await mood2.type(before.mood_status ?? "", { delay: 10 }); }
await p.locator("button:visible", { hasText: /Save profile/i }).first().click();
await p.waitForTimeout(5500);
const restored = await snapshot(QA);
console.log("RESTORE bio:", restored.bio === before.bio, "| mood:", restored.mood_status === before.mood_status);

const layout = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
console.log("LAYOUT", JSON.stringify(layout), "| overflow:", layout.doc > layout.win, "| save reachable:", Boolean(saveBox));
console.log("document loads:", loads, "| page errors:", errs.page.length, "| console errors:", errs.console.length);
await p.screenshot({ path: `C:/mb-profile-perf-p1/.shots/d6-profile-${VW}-${THEME}.png` });
await browser.close();

/* ---------- security carry: browser role, no service key ---------- */
console.log("\n=== D4 CARRY (browser role) ===");
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anon, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "qa@local.test", password: "HardeningPass123!" });

const kBefore = await snapshot(KOFI);
const cross = await c.from("profiles").update({ bio: "cross-user probe" }).eq("user_id", KOFI).select("user_id");
const kAfter = await snapshot(KOFI);
console.log("cross-user UPDATE:", cross.error ? `DENIED ${cross.error.code}` : `${(cross.data ?? []).length} rows`,
  "| B unchanged:", kAfter.bio === kBefore.bio);

for (const [col, val] of [["trusted_member_since", new Date().toISOString()], ["is_onboarded", false], ["deleted_at", null]]) {
  const was = (await snapshot(QA))[col];
  const r = await c.from("profiles").update({ [col]: val }).eq("user_id", QA).select("user_id");
  const now = (await snapshot(QA))[col];
  console.log(`  ${col.padEnd(22)} ${r.error ? "DENIED " + r.error.code : "ALLOWED"} | changed: ${String(was) !== String(now)}`);
}

const ins = await c.from("profiles").insert({ user_id: randomUUID(), full_name: "forged", username: `forged${Date.now()}`, username_normalized: `forged${Date.now()}` }).select("user_id");
console.log("arbitrary INSERT :", ins.error ? `DENIED ${ins.error.code}` : `ALLOWED (${(ins.data ?? []).length} rows)`);
const ups = await c.from("profiles").upsert({ user_id: QA, bio: "upsert probe" }, { onConflict: "user_id" }).select("user_id");
console.log("browser UPSERT   :", ups.error ? `DENIED ${ups.error.code}` : "ALLOWED");
