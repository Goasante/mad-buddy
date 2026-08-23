/**
 * Mission 3 Advanced — the journey ledger, driven against real account states.
 *
 * Each journey seeds the STATE it is about, signs in as that person, and records
 * what Home and the relevant surfaces actually offer. The question throughout is
 * not "does the route work" (Mission 1) but "does the person know what to do".
 *
 * Accounts are created the way seed-local does — admin.createUser with
 * email_confirm, never auth.signUp — and are removed at the end so the local
 * stack does not accumulate fixtures. A profile row is always written, because
 * admin.createUser alone produces NO profile and that is a state the product
 * cannot reach through signup (the trap MB-GOD-049 was nearly mis-diagnosed on).
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

const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";
const created = [];

/** A fully onboarded person, the way a completed signup leaves them. */
async function makePerson(tag, { onboarded = true } = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  await admin.from("profiles").insert({
    user_id: id,
    username: `${tag}${String(stamp).slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Tester`,
    is_onboarded: onboarded
  });
  created.push(id);
  return { id, email };
}

async function cleanup() {
  for (const id of created) {
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("friend_requests").delete().or(`sender_id.eq.${id},receiver_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const SNAPSHOT = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  const controls = Array.from(document.querySelectorAll("button, a[href], [role=button]"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    path: location.pathname + location.search,
    heading: (document.querySelector("h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
    sees: (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
    offers: [...new Set(controls)].slice(0, 12)
  };
};

const browser = await chromium.launch();

/** Signs in through the real login form and returns a page in that session. */
async function sessionFor(email) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2400);
  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);
  return { ctx, page };
}

const results = [];
async function journey(id, title, email, routes) {
  const { ctx, page } = await sessionFor(email);
  const row = { id, title, steps: [] };
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const s = await page.evaluate(SNAPSHOT).catch((e) => ({ path: route, sees: `ERROR ${String(e).slice(0, 60)}`, offers: [] }));
    row.steps.push({ route, ...s });
    await page.screenshot({ path: `${OUT}/${id}-${route.replace(/[^a-z0-9]/gi, "_") || "root"}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
  results.push(row);
  return row;
}

try {
  // --- JOURNEY 3: zero Muddies -------------------------------------------
  const solo = await makePerson("solo");
  await journey("J3-zero-muddies", "Onboarded, zero Muddies", solo.email,
    ["/dashboard", "/friends", "/messages", "/plans", "/linkr", "/hangout-mode"]);

  // --- JOURNEY 4: first Muddy, request PENDING ---------------------------
  const pending = await makePerson("pending");
  const { error: requestError } = await admin.from("friend_requests").insert({
    sender_id: pending.id, receiver_id: KOFI, status: "pending"
  });
  if (requestError) throw new Error(`friend request fixture failed: ${requestError.message}`);
  await journey("J4a-request-sent", "Request sent, not yet accepted", pending.email,
    ["/dashboard", "/friends"]);

  // --- JOURNEY 4b: first Muddy, ACCEPTED ---------------------------------
  const muddied = await makePerson("muddied");
  const [a, b] = [muddied.id, KOFI].sort();
  /* NO `status` COLUMN. `friendships` is keyed on `ended_at IS NULL`
     (lib/friends/service.ts:118), and an insert carrying `status: "active"`
     is REJECTED by PostgREST -- silently, unless the error is read. The first
     run of this journey did exactly that and measured a zero-Muddy account
     while claiming to test a first-Muddy one.

     Every seed below now asserts its own success, because a fixture that
     failed to apply is the most expensive kind of false evidence. */
  const { error: friendshipError } = await admin.from("friendships")
    .insert({ user_one_id: a, user_two_id: b });
  if (friendshipError) throw new Error(`friendship fixture failed: ${friendshipError.message}`);
  const { error: milestoneError } = await admin.from("activation_milestones")
    .insert({ user_id: muddied.id, milestone: "first_muddy_added" });
  if (milestoneError) throw new Error(`milestone fixture failed: ${milestoneError.message}`);
  await journey("J4b-first-muddy", "First Muddy accepted, no social act yet", muddied.email,
    ["/dashboard", "/friends", "/messages"]);

  // --- JOURNEY 6: location denied ----------------------------------------
  // Same state as J4b, but the browser refuses geolocation.
  {
    const ctx = await browser.newContext({
      viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, permissions: []
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2400);
    await page.fill('input[type="email"]', muddied.email);
    await page.locator('input[type="password"]').first().fill("HardeningPass123!");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6500);
    const row = { id: "J6-location-denied", title: "Muddy exists, location NOT granted", steps: [] };
    for (const route of ["/dashboard", "/friends"]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000);
      row.steps.push({ route, ...(await page.evaluate(SNAPSHOT)) });
      await page.screenshot({ path: `${OUT}/J6-${route.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
    }
    await ctx.close();
    results.push(row);
  }
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/journeys.json`, JSON.stringify(results, null, 2));
for (const r of results) {
  console.log(`\n${"=".repeat(92)}\n${r.id} — ${r.title}\n${"=".repeat(92)}`);
  for (const s of r.steps) {
    console.log(`\n  ${s.route}  ->  ${s.path}`);
    if (s.heading) console.log(`    heading: ${s.heading}`);
    console.log(`    sees   : ${(s.sees || "").slice(0, 230)}`);
    console.log(`    offers : ${s.offers.join(" | ").slice(0, 200)}`);
  }
}
console.log("\ncleaned up all journey accounts");
