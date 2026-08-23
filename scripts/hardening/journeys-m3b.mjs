/**
 * Mission 3 Advanced — the remaining canonical journeys.
 *
 * Each seeds the state it is about, asserts the seed applied, signs in as that
 * person, and records what the product actually offers. The question is
 * experiential: does the person know what happened and what to do next.
 *
 * FIXTURE DISCIPLINE (permanent): every insert reads its error, and every state
 * is one the real product can create. `friendships` has no `status` column;
 * `admin.createUser` writes no profile row. Both previously produced confident
 * findings about impossible states.
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
const AMA = "b66cd360-1f24-4b02-9b8c-123b522d0c61";
const made = [];

async function person(tag, { onboarded = true } = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Tester`, is_onboarded: onboarded
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

/** A live mutual Muddy relationship, the way the product creates it. */
async function befriend(a, b) {
  const [x, y] = [a, b].sort();
  const { error } = await admin.from("friendships").insert({ user_one_id: x, user_two_id: y });
  if (error) throw new Error(`friendship: ${error.message}`);
}

async function cleanup() {
  for (const id of made) {
    const { data: convos } = await admin.from("conversations").select("id").like("direct_key", `%${id}%`);
    for (const c of convos ?? []) {
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("friend_requests").delete().or(`sender_id.eq.${id},receiver_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const SNAP = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  return {
    path: location.pathname + location.search,
    heading: (document.querySelector("h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 64),
    sees: (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
    offers: [...new Set(Array.from(document.querySelectorAll("button, a[href]"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
      .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
      .filter(Boolean))].slice(0, 14)
  };
};

const browser = await chromium.launch();
const out = [];

async function visit(id, title, email, routes, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    ...(opts.noLocation ? { permissions: [] }
      : { permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 } })
  });
  const page = await ctx.newPage();
  if (email) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2300);
    await page.fill('input[type="email"]', email);
    await page.locator('input[type="password"]').first().fill("HardeningPass123!");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6200);
  }
  const row = { id, title, steps: [] };
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    // Dismiss the guided tour, or this audits the overlay rather than the page.
    for (let i = 0; i < 3; i += 1) {
      const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
      if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(900); } else break;
    }
    row.steps.push({ route, ...(await page.evaluate(SNAP).catch(() => ({ path: route, sees: "(unreadable)", offers: [] }))) });
    await page.screenshot({ path: `${OUT}/${id}-${route.replace(/[^a-z0-9]/gi, "_") || "root"}.png`, fullPage: true }).catch(() => {});
  }
  await ctx.close();
  out.push(row);
}

try {
  // --- J8: INVITE, opened while SIGNED OUT --------------------------------
  await visit("J8-invite-signed-out", "Invite link opened with no session", null,
    ["/invite", "/invite/does-not-exist"]);

  // --- J10/J11: LINKR, activated but no candidates ------------------------
  const linkr = await person("linkr");
  await visit("J10-linkr", "Linkr, eligible and not yet activated", linkr.email,
    ["/linkr"]);

  // --- J12: UPFOR, first time ---------------------------------------------
  const upfor = await person("upfor");
  await befriend(upfor.id, KOFI);
  await visit("J12-upfor", "UpFor, first visit with one Muddy", upfor.email,
    ["/hangout-mode"]);

  // --- J15/J17/J19: PLANS, EVENTS, SAFE ARRIVAL from a normal account -----
  const social = await person("social");
  await befriend(social.id, KOFI);
  await befriend(social.id, AMA);
  await visit("J15-plans-events-safety", "Plans, Events and Safe Arrival, two Muddies", social.email,
    ["/plans", "/events", "/safe-arrival", "/notifications"]);

  // --- J21: DORMANT RETURN, unread message waiting ------------------------
  const dormant = await person("dormant");
  await befriend(dormant.id, KOFI);
  const directKey = [dormant.id, KOFI].sort().join(":");
  const { data: convo, error: cErr } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: KOFI, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (cErr) throw new Error(`conversation: ${cErr.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: dormant.id, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: KOFI, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: KOFI, message_type: "text",
    text_content: "Are you around this week?", client_message_id: crypto.randomUUID()
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);
  await visit("J21-dormant-return", "Returning with an unread message", dormant.email,
    ["/dashboard", "/messages"]);
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/journeys-b.json`, JSON.stringify(out, null, 2));
for (const r of out) {
  console.log(`\n${"=".repeat(92)}\n${r.id} — ${r.title}\n${"=".repeat(92)}`);
  for (const s of r.steps) {
    console.log(`\n  ${s.route}  ->  ${s.path}`);
    if (s.heading) console.log(`    heading: ${s.heading}`);
    console.log(`    sees   : ${(s.sees || "").slice(0, 240)}`);
    console.log(`    offers : ${s.offers.join(" | ").slice(0, 190)}`);
  }
}
console.log("\ncleaned up all journey accounts");
