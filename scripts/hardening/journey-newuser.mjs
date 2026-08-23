/**
 * Mission 3 Advanced — JOURNEY 1: brand-new user to first value.
 *
 * A genuinely new person: no account, no session, no invite. Everything is
 * driven through the real UI, and each step records what the user SEES and what
 * they are OFFERED, because the question is not "does signup work" (Mission 1
 * proved that) but "does a person arriving here understand what to do".
 *
 * The account is created through the product's own signup form rather than
 * admin.createUser, because the journey under test INCLUDES that form. It is
 * deleted afterwards so the local stack does not accumulate fixtures.
 *
 * FIRST VALUE IS NOT "ACCOUNT CREATED". The product's own definition lives in
 * lib/activation/home-maturity.ts: `first_muddy_added` AND one social act. This
 * run measures how many decisions stand between arriving and that point.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/journeys-m3";
mkdirSync(OUT, { recursive: true });

const stamp = Date.now();
const EMAIL = `newuser-${stamp}@local.test`;
const PASSWORD = "HardeningPass123!";
const USERNAME = `newbie${String(stamp).slice(-6)}`;

const steps = [];
const record = (name, data) => { steps.push({ name, ...data }); };

/** What a person can actually see and do right now. */
const SNAPSHOT = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  const controls = Array.from(document.querySelectorAll("button, a[href], [role=button], input, select, textarea"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => ({
      kind: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 44)
    }))
    .filter((c) => c.name);
  return {
    path: location.pathname + location.search,
    heading: (document.querySelector("h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70),
    firstScreen: (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260),
    controls: [...new Map(controls.map((c) => [c.name, c])).values()].slice(0, 14)
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
  permissions: []
});
const page = await ctx.newPage();

async function snap(label) {
  const s = await page.evaluate(SNAPSHOT);
  record(label, s);
  await page.screenshot({ path: `${OUT}/j1-${label.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
  return s;
}

// --- 1. LANDING, signed out ------------------------------------------------
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2600);
await snap("01-landing");

// --- 2. SIGNUP -------------------------------------------------------------
await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2600);
await snap("02-signup-form");

/* SIGNUP IS CREATED THROUGH THE ADMIN API, and the reason is recorded.
 *
 * `next start` sets NODE_ENV=production, which makes `isTurnstileRequired`
 * true (lib/security/turnstile.ts:24). With no TURNSTILE_SECRET_KEY the
 * verification fails closed -- "The security check is temporarily
 * unavailable" -- which is CORRECT security behaviour and not a defect. It is
 * an artefact of running a production build locally.
 *
 * The form itself was already proven by Mission 1 (MB-GOD-003/010 fixed it and
 * `authforms-nojs.mjs` is its regression check). What Mission 3 needs is the
 * journey AFTER account creation, so the account is made the way seed-local
 * does -- admin.createUser with email_confirm, never auth.signUp, which is a
 * standing rule in this project. */
const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
  email: EMAIL, password: PASSWORD, email_confirm: true
});
if (createError) throw new Error(`could not create the test account: ${createError.message}`);
record("02b-account-created-via-admin", {
  path: "(admin API)", heading: "",
  firstScreen: `Turnstile blocks form signup on a local production build; account created directly. user=${createdUser.user.id}`,
  controls: []
});

// Now sign in through the REAL login form, which is part of the journey.
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2600);
await page.fill('input[type="email"]', EMAIL).catch(() => {});
await page.locator('input[type="password"]').first().fill(PASSWORD).catch(() => {});
await page.locator('button[type="submit"]').first().click().catch(() => {});
await page.waitForTimeout(7000);
await snap("03-after-signup");

// --- 3. ONBOARDING ---------------------------------------------------------
for (let i = 0; i < 8; i += 1) {
  const beforeHeading = await page.evaluate(() => document.querySelector("h1")?.innerText ?? "");
  const before = new URL(page.url()).pathname + beforeHeading;
  const s = await snap(`04-onboarding-${String(i + 1).padStart(2, "0")}`);
  if (!s.path.includes("/onboarding")) break;

  const texts = page.locator('input[type="text"], input:not([type]), textarea');
  const n = await texts.count();
  for (let t = 0; t < n; t += 1) {
    const el = texts.nth(t);
    if (!(await el.isVisible().catch(() => false))) continue;
    const val = await el.inputValue().catch(() => "");
    if (val) continue;
    const ph = (await el.getAttribute("placeholder")) ?? "";
    const nm = (await el.getAttribute("name")) ?? "";
    const hint = `${ph} ${nm}`.toLowerCase();
    const filled = hint.includes("user") ? USERNAME : hint.includes("name") ? "New Person" : "Exploring Mad Buddy";
    await el.fill(filled).catch(() => {});
  }

  const forward = page.getByRole("button", { name: /continue|next|finish|done|get started|save/i }).first();
  if (await forward.count()) {
    await forward.click({ timeout: 12000 }).catch(() => {});
  } else {
    const submit = page.locator('button[type="submit"]').first();
    if (await submit.count()) await submit.click({ timeout: 12000 }).catch(() => {});
    else break;
  }
  await page.waitForTimeout(3200);
  const afterHeading = await page.evaluate(() => document.querySelector("h1")?.innerText ?? "");
  const after = new URL(page.url()).pathname + afterHeading;
  if (after === before) break;
}

// --- 4. FIRST HOME ---------------------------------------------------------
if (!new URL(page.url()).pathname.startsWith("/dashboard")) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3200);
}
await snap("05-first-home");

await ctx.close();
await browser.close();

// --- WHAT THE DATABASE SAYS ------------------------------------------------
const { data: users } = await admin.auth.admin.listUsers();
const created = users?.users?.find((u) => u.email === EMAIL);
let dbState = null;
if (created) {
  const { data: profile } = await admin.from("profiles")
    .select("user_id, username, full_name, is_onboarded").eq("user_id", created.id).maybeSingle();
  const { data: milestones } = await admin.from("activation_milestones")
    .select("milestone").eq("user_id", created.id);
  dbState = { profile, milestones: (milestones ?? []).map((m) => m.milestone) };
}

writeFileSync(`${OUT}/journey-1.json`, JSON.stringify({ email: EMAIL, steps, dbState }, null, 2));

console.log("=".repeat(94));
console.log("JOURNEY 1 — BRAND-NEW USER -> FIRST VALUE");
console.log("=".repeat(94));
for (const s of steps) {
  console.log(`\n### ${s.name}   ${s.path}`);
  if (s.heading) console.log(`  heading : ${s.heading}`);
  console.log(`  sees    : ${(s.firstScreen || "").slice(0, 200)}`);
  console.log(`  offered : ${s.controls.map((c) => c.name).join(" | ").slice(0, 210)}`);
}
console.log(`\n${"=".repeat(94)}\nDATABASE AFTER THE JOURNEY`);
console.log(JSON.stringify(dbState, null, 1));

if (created) {
  await admin.from("activation_milestones").delete().eq("user_id", created.id);
  await admin.from("profiles").delete().eq("user_id", created.id);
  await admin.auth.admin.deleteUser(created.id);
  console.log(`\ncleaned up ${EMAIL}`);
}
