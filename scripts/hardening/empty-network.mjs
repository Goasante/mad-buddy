/**
 * Mission 3 God Mode, Axis 2 — empty-network resilience.
 *
 * The hardest state in a social product is not a bug: somebody arrives and
 * nobody they know is here. Nothing is faked to soften it — no fake users, no
 * fake UpFors, no fake proximity. The question is whether Mad Buddy still
 * offers a truthful, useful next action, or whether it becomes a graveyard.
 *
 * Measured per surface: does it EXPLAIN the emptiness, and does it OFFER
 * something that would actually change it? A surface that only reports absence
 * fails; a surface that explains and offers a real action passes.
 *
 * FIXTURE DISCIPLINE: the account is created the way a completed signup leaves
 * one, every write reads its error, and sign-in is asserted.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/empty-network";
mkdirSync(OUT, { recursive: true });

const made = [];
const rows = [];

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag.replace(/[^a-z0-9]/gi, "")}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Alone`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

async function cleanup() {
  for (const id of made) {
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

/* An "action" is something that could plausibly CHANGE the empty state --
   inviting, finding, creating, turning something on. Navigation chrome and
   the tab strip are excluded: being able to reach another empty page is not
   an answer to emptiness. */
const CHROME = new Set([
  "Menu", "Notifications", "Add Muddy", "Quick controls", "Open quick actions",
  "Messages", "Muddies", "Home", "Linkr", "UpFor", "Moments", "Plans", "Events",
  "Safe Arrival", "Circles", "Back", "Skip to content", "All", "Unread",
  "Requests", "Blocked", "Nearby", "Close Friends", "Discover", "Yours",
  "Hosting", "Upcoming", "Invitations", "Created by you", "No date yet", "Past",
  "For You", "Around", "Groups", "Pin more conversations"
]);

const READ = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  const controls = [...new Set(Array.from(document.querySelectorAll("button, a[href]"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
    .filter(Boolean))];
  return { text: (main.innerText || "").replace(/\s+/g, " ").trim(), controls };
};

const browser = await chromium.launch();
try {
  const solo = await person("solo");
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2400);
  await page.fill('input[type="email"]', solo.email);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  /* Wait for the NAVIGATION, not a fixed guess. A brand-new account's first
     authenticated render is slower than a warm one, and a flat 6.5s timeout
     made a working sign-in look like a failure. */
  await page.waitForURL((u) => !new URL(u).pathname.startsWith("/login"), { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error(`sign-in failed: still on ${new URL(page.url()).pathname}`);
  }

  for (const route of ["/dashboard", "/friends", "/messages", "/linkr",
                       "/hangout-mode", "/plans", "/events", "/notifications", "/groups"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    for (let i = 0; i < 3; i += 1) {
      const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
      if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(900); } else break;
    }
    const seen = await page.evaluate(READ);
    const actions = seen.controls.filter((c) => !CHROME.has(c));
    /* Does the copy EXPLAIN, or only report? An explanation says why the
       surface is empty or what would fill it; a bare "no results" does not. */
    const explains = /will (show|appear)|when (you|your|one|somebody)|get started|start (one|with)|to see|so you|check back|invite|add (a|your)/i
      .test(seen.text);
    rows.push({ route, explains, actionCount: actions.length, actions: actions.slice(0, 5),
                text: seen.text.slice(0, 190) });
    await page.screenshot({ path: `${OUT}/${route.replace(/[^a-z0-9]/gi, "_") || "root"}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/empty-network.json`, JSON.stringify(rows, null, 2));
console.log(`\n${"=".repeat(94)}\nEMPTY NETWORK — one real account, nobody else\n${"=".repeat(94)}`);
let graveyards = 0;
for (const r of rows) {
  const verdict = r.actionCount > 0 && r.explains ? "USEFUL"
    : r.actionCount > 0 ? "action, no explanation"
    : r.explains ? "explains, NO ACTION"
    : "GRAVEYARD";
  if (verdict === "GRAVEYARD") graveyards += 1;
  console.log(`\n${r.route.padEnd(15)} ${verdict}`);
  console.log(`   explains: ${r.explains}   real actions: ${r.actionCount}  ${r.actions.join(" | ").slice(0, 120)}`);
  console.log(`   ${r.text.slice(0, 160)}`);
}
console.log(`\n${rows.length - graveyards}/${rows.length} surfaces offer a truthful way forward when the network is empty`);
