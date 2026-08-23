/**
 * Mission 3 God Mode, Axes 12/18/19 — does Home learn the user over time?
 *
 * Not snapshots: a SEQUENCE on one account, advancing the same way real use
 * would. After each step Home is re-read, so the question is whether education
 * recedes, celebration retires, and setup stops resurfacing.
 *
 * Time is advanced by moving canonical timestamps in local fixtures, which is
 * safe and is the only way to observe a six-hour window inside one run.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/maturity";
mkdirSync(OUT, { recursive: true });

const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";
const made = [];
const steps = [];

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
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const READ = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  const text = (main.innerText || "").replace(/\s+/g, " ").trim();
  return {
    sections: Array.from(main.querySelectorAll("h2, h3"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
      .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 32)),
    celebration: /Your first Muddy is here/i.test(text),
    setupNudge: /Complete your profile/i.test(text),
    education: /Add your first Muddy|Start with one person|Waiting on your first/i.test(text),
    text: text.slice(0, 170)
  };
};

const browser = await chromium.launch();
try {
  const stamp = `${Date.now()}`;
  const email = `mat-${stamp}@local.test`;
  const { data: u, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`account: ${error.message}`);
  const me = u.user.id;
  made.push(me);
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: me, username: `mat${stamp.slice(-6)}`, full_name: "Mat Progress", is_onboarded: true
  });
  if (pErr) throw new Error(`profile: ${pErr.message}`);

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
  await page.waitForURL((x) => !new URL(x).pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  async function look(label) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3400);
    for (let i = 0; i < 3; i += 1) {
      const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
      if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(900); } else break;
    }
    const s = await page.evaluate(READ);
    steps.push({ label, ...s });
    await page.screenshot({ path: `${OUT}/${label.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
  }

  await look("1 day0 zero Muddies");

  const [a, b] = [me, KOFI].sort();
  const { error: fe } = await admin.from("friendships").insert({ user_one_id: a, user_two_id: b });
  if (fe) throw new Error(`friendship: ${fe.message}`);
  const { error: me1 } = await admin.from("activation_milestones")
    .insert({ user_id: me, milestone: "first_muddy_added" });
  if (me1) throw new Error(`milestone: ${me1.message}`);
  await look("2 day1 first Muddy");

  const { error: me2 } = await admin.from("activation_milestones")
    .insert({ user_id: me, milestone: "first_message_sent" });
  if (me2) throw new Error(`milestone2: ${me2.message}`);
  await look("3 day2 first message (first value complete)");

  // Age the celebration past its six-hour window.
  const { error: ageErr } = await admin.from("activation_milestones")
    .update({ reached_at: new Date(Date.now() - 7 * 3600e3).toISOString() })
    .eq("user_id", me).eq("milestone", "first_muddy_added");
  if (ageErr) throw new Error(`age: ${ageErr.message}`);
  await look("4 day3 celebration window passed");

  await ctx.close();
} catch (e) {
  console.log(`HARNESS ERROR: ${String(e).split("\n")[0].slice(0, 150)}`);
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/progression.json`, JSON.stringify(steps, null, 2));
console.log(`\n${"=".repeat(94)}\nHOME OVER TIME — one account, advancing\n${"=".repeat(94)}`);
for (const s of steps) {
  console.log(`\n${s.label}`);
  console.log(`   sections   : ${s.sections.join(" > ") || "(none)"}`);
  console.log(`   celebration: ${s.celebration}   setup nudge: ${s.setupNudge}   early education: ${s.education}`);
  console.log(`   ${s.text.slice(0, 150)}`);
}
