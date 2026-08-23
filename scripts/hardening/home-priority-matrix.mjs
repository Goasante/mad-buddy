/**
 * Mission 3 Extreme — the Home priority matrix (MB-GOD-052).
 *
 * Advanced found that a returning user with an unread message sees Home lead
 * with empty states and "Complete your profile, 3 steps left". Before changing
 * anything, this establishes what Home ACTUALLY leads with across the state
 * combinations the brief names, so the priority decision is made against
 * evidence rather than against one observation.
 *
 * Reads the ORDER of rendered sections, not just their presence: "leads with"
 * is a question about position. The guided tour is dismissed on every run --
 * an undismissed run audits the overlay, not Home.
 *
 * FIXTURE DISCIPLINE: every insert reads its error; `friendships` has no
 * `status` column; `admin.createUser` writes no profile row.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/home-priority";
mkdirSync(OUT, { recursive: true });

const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";
const made = [];

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    // `profiles_username_format` rejects hyphens, so the tag is stripped to
    // letters -- caught by the fixture assertion rather than by a confusing
    // journey result.
    user_id: id, username: `${tag.replace(/[^a-z0-9]/gi, "")}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Tester`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

async function befriend(a, b) {
  const [x, y] = [a, b].sort();
  const { error } = await admin.from("friendships").insert({ user_one_id: x, user_two_id: y });
  if (error) throw new Error(`friendship: ${error.message}`);
}

/** An unread message FROM Kofi TO this person, the way the product creates it. */
async function unreadFrom(userId) {
  const directKey = [userId, KOFI].sort().join(":");
  const { data: convo, error } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: KOFI, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (error) throw new Error(`conversation: ${error.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: userId, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: KOFI, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: KOFI, message_type: "text",
    text_content: "Are you around this week?", client_message_id: crypto.randomUUID()
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);
  return convo.id;
}

/** A real upcoming Plan this person is on, via the canonical RPC. */
async function upcomingPlan(hostId, guestId) {
  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: hostId,
    p_request_key: crypto.randomUUID(),
    p_title: "Matrix dinner",
    p_description: "Priority matrix fixture.",
    p_plan_type: "scheduled",
    p_start_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
    p_end_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
    p_timezone: "Africa/Accra",
    p_rsvp_deadline: null,
    p_place_type: "custom",
    p_custom_place_text: "The usual place",
    p_reminder_minutes: 30,
    p_category: null,
    p_invitee_ids: [guestId],
    p_initial_going_ids: [],
    p_source_hangout_id: null,
    p_effective_max_active_plans: 10,
    p_effective_max_participants: 20
  });
  if (error) throw new Error(`plan: ${error.message}`);
  return Array.isArray(data) ? data[0]?.plan_id ?? data[0]?.id : data?.plan_id ?? data?.id;
}

async function cleanup() {
  for (const id of made) {
    const { data: convos } = await admin.from("conversations").select("id").like("direct_key", `%${id}%`);
    for (const c of convos ?? []) {
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    const { data: plans } = await admin.from("plans").select("id").eq("creator_id", id);
    for (const pl of plans ?? []) {
      await admin.from("plan_participants").delete().eq("plan_id", pl.id);
      const { data: pc } = await admin.from("conversations").select("id").eq("context_id", pl.id);
      for (const c of pc ?? []) {
        await admin.from("messages").delete().eq("conversation_id", c.id);
        await admin.from("conversation_members").delete().eq("conversation_id", c.id);
        await admin.from("conversations").delete().eq("id", c.id);
      }
      await admin.from("plans").delete().eq("id", pl.id);
    }
    await admin.from("plan_participants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

/** The ORDER of Home's sections, plus whether unread is mentioned at all. */
const READ_HOME = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  const sections = Array.from(main.querySelectorAll("h1, h2, h3"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => ({
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
      y: Math.round(el.getBoundingClientRect().top + window.scrollY)
    }))
    .sort((a, b) => a.y - b.y);
  const raw = (main.innerText || "").replace(/\s+/g, " ");
  /* The greeting contains the ACCOUNT'S OWN NAME, and a fixture called
     "Mx-unread Tester" matched /unread/ — the probe detecting its own test
     data and reporting that Home surfaced the message. The greeting is
     excluded before any content test. */
  const text = raw.replace(/Good (morning|afternoon|evening),[^.]*?(?=\s(Near|My Plans|You|Suggestions|$))/i, " ");
  return {
    sections,
    mentionsUnread: /unread|new message|wrote to you|replied|message from/i.test(text),
    mentionsSender: /Kofi/i.test(text),
    mentionsProfileSetup: /Complete your profile/i.test(text),
    text: raw.slice(0, 240)
  };
};

const browser = await chromium.launch();
const rows = [];

async function measure(label, email) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2300);
  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6200);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3600);
  for (let i = 0; i < 3; i += 1) {
    const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
    if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(900); } else break;
  }
  await page.waitForTimeout(1000);
  const home = await page.evaluate(READ_HOME);
  await page.screenshot({ path: `${OUT}/${label.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
  await ctx.close();
  rows.push({ label, ...home });
}

try {
  // 1. unread + incomplete profile (the Advanced observation)
  const a = await person("mx-unread");
  await befriend(a.id, KOFI);
  await unreadFrom(a.id);
  await measure("1 unread + incomplete profile", a.email);

  // 2. unread + upcoming Plan
  const b = await person("mx-plan");
  await befriend(b.id, KOFI);
  await unreadFrom(b.id);
  await upcomingPlan(KOFI, b.id);
  await measure("2 unread + upcoming Plan", b.email);

  // 3. upcoming Plan, NO unread — the control for what a Plan alone does
  const c = await person("mx-planonly");
  await befriend(c.id, KOFI);
  await upcomingPlan(KOFI, c.id);
  await measure("3 upcoming Plan, no unread", c.email);

  // 4. no unread, no Plan — the baseline
  const d = await person("mx-quiet");
  await befriend(d.id, KOFI);
  await measure("4 quiet: Muddy only", d.email);
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/matrix.json`, JSON.stringify(rows, null, 2));
console.log(`\n${"=".repeat(94)}\nHOME PRIORITY MATRIX\n${"=".repeat(94)}`);
for (const r of rows) {
  console.log(`\n### ${r.label}`);
  console.log(`  order         : ${r.sections.map((s) => s.text).join("  >  ")}`);
  console.log(`  unread shown  : ${r.mentionsUnread ? "YES" : "NO"}   sender named: ${r.mentionsSender ? "yes" : "no"}`);
  console.log(`  profile setup : ${r.mentionsProfileSetup ? "SHOWN" : "not shown"}`);
  console.log(`  text          : ${r.text.slice(0, 180)}`);
}
console.log("\ncleaned up all matrix accounts");
