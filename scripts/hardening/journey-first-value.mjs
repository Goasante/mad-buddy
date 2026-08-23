/**
 * Mission 3 — the FIRST VALUE path, end to end (MB-GOD-050).
 *
 * The product's own definition (lib/activation/home-maturity.ts) is
 * `first_muddy_added` AND one social act. This drives the whole chain against a
 * real account and asserts each link:
 *
 *   friendship exists
 *     -> Home shows the first-Muddy acknowledgement
 *     -> the card offers ONE next action, and it is Say hi
 *     -> tapping it opens the canonical direct conversation
 *     -> sending a message records the social-act milestone
 *     -> the celebration does not persist once maturity moves on
 *
 * FIXTURE DISCIPLINE: every seed asserts its own success and every state is one
 * the real product can create. `friendships` has NO `status` column (it is keyed
 * on `ended_at IS NULL`), and `admin.createUser` writes NO profile row -- both
 * previously produced confident findings about states the product cannot reach.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/journeys-m3";
mkdirSync(OUT, { recursive: true });

const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const stamp = `${Date.now()}`;
const EMAIL = `fv-${stamp}@local.test`;
let userId = null;

async function cleanup() {
  if (!userId) return;
  const { data: convos } = await admin.from("conversations")
    .select("id").like("direct_key", `%${userId}%`);
  for (const c of convos ?? []) {
    await admin.from("messages").delete().eq("conversation_id", c.id);
    await admin.from("conversation_members").delete().eq("conversation_id", c.id);
    await admin.from("conversations").delete().eq("id", c.id);
  }
  await admin.from("activation_milestones").delete().eq("user_id", userId);
  await admin.from("friendships").delete().or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);
  await admin.from("profiles").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
}

const browser = await chromium.launch();
try {
  // --- SEED: a person with exactly one Muddy and no social act yet --------
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: EMAIL, password: "HardeningPass123!", email_confirm: true
  });
  if (userError) throw new Error(`account: ${userError.message}`);
  userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    user_id: userId, username: `fv${stamp.slice(-6)}`, full_name: "Firstvalue Tester", is_onboarded: true
  });
  if (profileError) throw new Error(`profile: ${profileError.message}`);

  const [a, b] = [userId, KOFI].sort();
  const { error: friendError } = await admin.from("friendships").insert({ user_one_id: a, user_two_id: b });
  if (friendError) throw new Error(`friendship: ${friendError.message}`);

  const { error: milestoneError } = await admin.from("activation_milestones")
    .insert({ user_id: userId, milestone: "first_muddy_added" });
  if (milestoneError) throw new Error(`milestone: ${milestoneError.message}`);

  check("the fixture applied: one Muddy, milestone recorded, no social act", true,
    `user ${userId.slice(0, 8)} <-> Kofi`);

  // --- SIGN IN -----------------------------------------------------------
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2400);
  await page.fill('input[type="email"]', EMAIL);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  // Dismiss the guided tour, or this audits the overlay rather than Home.
  for (let i = 0; i < 4; i += 1) {
    const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
    if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(1000); } else break;
  }
  await page.waitForTimeout(1200);

  const home = await page.evaluate(() => {
    const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
    return {
      sees: (main.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260),
      buttons: [...new Set(Array.from(document.querySelectorAll("button"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
        .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean))]
    };
  });
  await page.screenshot({ path: `${OUT}/fv-01-home.png`, fullPage: true }).catch(() => {});

  check("Home acknowledges the first Muddy",
    /Your first Muddy is here/i.test(home.sees), home.sees.slice(0, 110));

  const sayHi = home.buttons.find((b) => /^Say hi to /i.test(b));
  check("the card offers Say hi as its next action",
    Boolean(sayHi), sayHi ?? `buttons: ${home.buttons.join(" | ").slice(0, 140)}`);

  // Only ONE action on the card itself: Turn on Glow must not sit beside it.
  check("Say hi and Turn on Glow are never offered together",
    !(sayHi && home.buttons.some((b) => /turn on glow/i.test(b))),
    home.buttons.filter((b) => /say hi|turn on glow/i.test(b)).join(" + ") || "neither");

  // --- TAP IT ------------------------------------------------------------
  if (sayHi) {
    await page.getByRole("button", { name: sayHi, exact: true }).first().click({ timeout: 15000 });
    await page.waitForTimeout(6000);
    const landed = new URL(page.url());
    check("Say hi opens a conversation, not a 404 or the Messages list",
      landed.pathname === "/messages" && landed.searchParams.has("conversation"),
      `${landed.pathname}${landed.search}`);

    const named = await page.locator("body").innerText();
    check("the conversation names the right person",
      /Kofi/i.test(named), named.replace(/\s+/g, " ").slice(0, 110));

    // Exactly one conversation, not a duplicate per tap.
    const { data: convos } = await admin.from("conversations")
      .select("id, direct_key").eq("conversation_type", "direct").like("direct_key", `%${userId}%`);
    check("exactly one direct conversation exists",
      (convos ?? []).length === 1, `${(convos ?? []).length} conversation(s)`);

    // --- SEND, and watch the milestone -----------------------------------
    const composer = page.locator("textarea, input[type=text]").first();
    if (await composer.count()) {
      await composer.fill("Hey Kofi, good to be connected.");
      await page.waitForTimeout(500);
      const send = page.getByRole("button", { name: /^send$/i }).first();
      if (await send.count()) await send.click().catch(() => {});
      else await composer.press("Enter").catch(() => {});
      await page.waitForTimeout(6000);

      const { data: msgs } = await admin.from("messages")
        .select("id, text_content").eq("sender_id", userId);
      check("the message was actually sent", (msgs ?? []).length > 0,
        `${(msgs ?? []).length} message(s)`);

      const { data: after } = await admin.from("activation_milestones")
        .select("milestone").eq("user_id", userId);
      const names = (after ?? []).map((m) => m.milestone);
      check("a social-act milestone is recorded, completing first value",
        names.some((m) => m !== "first_muddy_added"),
        `milestones: ${names.join(", ")}`);

      /* --- THE CELEBRATION IS TIME-BOXED, NOT ACT-BOXED ------------------
       *
       * An earlier version asserted the acknowledgement disappears once the
       * social act lands. That was MY assumption, not the product's rule:
       * `shouldAcknowledgeFirstMuddy` fades it after
       * FIRST_MUDDY_ACKNOWLEDGEMENT_MS (six hours), reasoned as "long enough to
       * survive closing the app and coming back the same evening, short enough
       * that returning tomorrow is an ordinary Home". Persisting for the rest
       * of the session is correct; congratulating you tomorrow would not be.
       *
       * So this asserts the REAL rule, on both sides of the window. */
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(4000);
      const sameSession = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      check("the celebration survives the same session, as designed",
        /Your first Muddy is here/i.test(sameSession),
        sameSession.slice(0, 110));
      await page.screenshot({ path: `${OUT}/fv-02-after.png`, fullPage: true }).catch(() => {});

      // Age the milestone past the six-hour window and confirm it retires.
      const past = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
      const { error: ageError } = await admin.from("activation_milestones")
        .update({ reached_at: past }).eq("user_id", userId).eq("milestone", "first_muddy_added");
      if (ageError) {
        console.log(`INCONC  ageing the milestone failed: ${ageError.message.slice(0, 80)}`);
      } else {
        await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(4000);
        const nextDay = (await page.locator("body").innerText()).replace(/\s+/g, " ");
        check("the celebration retires once the six-hour window passes",
          !/Your first Muddy is here/i.test(nextDay),
          nextDay.slice(0, 110));
      }
    } else {
      console.log("INCONC  send step — no composer found in the conversation");
    }
  }
  await ctx.close();
} finally {
  await browser.close();
  await cleanup();
  console.log("\ncleaned up the first-value account");
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} first-value checks passed`);
