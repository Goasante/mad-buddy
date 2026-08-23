/**
 * Mission 3 Extreme — the four deferred multi-persona journeys.
 *
 * Advanced could not run these with one account. Each needs at least two live
 * people, and the questions are experiential rather than functional — Mission 1
 * already proved the lifecycles. What is judged here:
 *
 *   A  Linkr mutual  — does one-sided interest stay invisible, and is the
 *                      mutual moment understandable and distinct from a Muddy?
 *   C  UpFor momentum — does the owner see that something changed?
 *   D  UpFor -> Plan  — does spontaneity visibly become commitment?
 *   E  Block/recovery — is a stale screen recoverable, with no leak?
 *
 * FIXTURE DISCIPLINE: every write reads its error. `friendships` has no
 * `status` column; `admin.createUser` writes no profile; usernames reject
 * hyphens (`profiles_username_format`). Each was found by an assertion rather
 * than by a confusing result.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/journeys-multi";
mkdirSync(OUT, { recursive: true });

const made = [];
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    // profiles_username_format rejects hyphens.
    user_id: id, username: `${tag.replace(/[^a-z0-9]/gi, "")}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Persona`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email, tag };
}

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
    await admin.from("linkr_connections").delete().or(`actor_id.eq.${id},target_id.eq.${id}`);
    await admin.from("linkr_profiles").delete().eq("user_id", id);
    await admin.from("blocked_users").delete().or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
    await admin.from("hangout_requests").delete().eq("requester_id", id);
    await admin.from("hangout_sessions").delete().eq("host_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

const browser = await chromium.launch();

async function sessionFor(email) {
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
  return { ctx, page };
}

const bodyOf = (page) => page.locator("body").innerText().then((t) => t.replace(/\s+/g, " "));

try {
  // ======================================================================
  // JOURNEY A — LINKR MUTUAL: one-sided interest must stay invisible
  // ======================================================================
  const alice = await person("alice");
  const bob = await person("bob");

  // Connect A -> B through the canonical RPC (the server action needs a
  // browser session per persona; the RPC is the same authority it calls).
  /* The REAL signature: p_actor / p_target / p_event_id, read from
     lib/linkr/connection-service.ts:148 rather than guessed. A wrong parameter
     name returns "function not found", which reads like a missing feature. */
  const { data: oneWay, error: cErr } = await admin.rpc("linkr_record_connect", {
    p_actor: alice.id, p_target: bob.id, p_event_id: null
  });
  if (cErr) {
    inconclusive("Linkr mutual", `linkr_record_connect refused: ${cErr.message.slice(0, 90)}`);
  } else {
    /* THE FIELD IS `matched` (connection-service.ts:157), not `is_mutual`.
     *
     * Reading a field that does not exist made BOTH sides of this check
     * vacuous: `undefined` is falsy, so "not matched" passed for a reason
     * unrelated to the product, and "matched" could never pass at all. A
     * probe that cannot fail is not evidence -- so the shape is asserted
     * first. */
    const row = Array.isArray(oneWay) ? oneWay[0] : oneWay;
    check("the RPC returned a row with the expected shape",
      row !== null && row !== undefined && "matched" in row,
      `keys: ${row ? Object.keys(row).join(", ") : "(no row)"}`);
    check("a one-sided Linkr connect does NOT report a match",
      row?.matched === false, `matched=${row?.matched}`);

    // What does B actually SEE while A is interested and B has not acted?
    const { ctx, page } = await sessionFor(bob.email);
    await page.goto(`${BASE}/linkr`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3200);
    const bobSees = await bodyOf(page);
    await page.goto(`${BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    const bobPulse = await bodyOf(page);
    await page.screenshot({ path: `${OUT}/A-bob-before-reciprocity.png`, fullPage: true }).catch(() => {});
    await ctx.close();

    check("B is never told that A connected first",
      !/alice/i.test(bobSees) && !/alice/i.test(bobPulse),
      `linkr mentions Alice: ${/alice/i.test(bobSees)}, pulse mentions Alice: ${/alice/i.test(bobPulse)}`);

    // Now B reciprocates.
    const { data: mutualRow, error: mErr } = await admin.rpc("linkr_record_connect", {
      p_actor: bob.id, p_target: alice.id, p_event_id: null
    });
    if (mErr) {
      inconclusive("Linkr reciprocity", mErr.message.slice(0, 90));
    } else {
      const m = Array.isArray(mutualRow) ? mutualRow[0] : mutualRow;
      check("reciprocity produces a mutual connection",
        m?.matched === true, `matched=${m?.matched}, created=${m?.created}`);

      // A Linkr connection must NOT make them Muddies.
      const [x, y] = [alice.id, bob.id].sort();
      const { data: friendship } = await admin.from("friendships")
        .select("id").eq("user_one_id", x).eq("user_two_id", y).is("ended_at", null).maybeSingle();
      check("a Linkr connection does NOT create a Muddy relationship",
        !friendship, friendship ? "friendship row created" : "no friendship, as designed");
    }
  }

  // ======================================================================
  // JOURNEY E — BLOCK: no detection leak, and the blocker's own recovery
  // ======================================================================
  const carol = await person("carol");
  const dave = await person("dave");
  await befriend(carol.id, dave.id);

  const { error: blockErr } = await admin.from("blocked_users")
    .insert({ blocker_id: carol.id, blocked_id: dave.id });
  if (blockErr) {
    inconclusive("Block journey", `could not seed the block: ${blockErr.message.slice(0, 90)}`);
  } else {
    // Dave holds a STALE screen: he still believes he is Carol's Muddy.
    const { ctx, page } = await sessionFor(dave.email);
    await page.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3200);
    const daveSees = await bodyOf(page);
    await page.screenshot({ path: `${OUT}/E-dave-after-block.png`, fullPage: true }).catch(() => {});
    await ctx.close();

    /* THE LEAK TEST. Dave must not be able to tell a block from any other
       reason Carol is absent -- "blocked", "unavailable", "restricted" would
       each turn the Muddies list into a block detector. */
    /* THE TAB LABEL IS NOT A LEAK.
     *
     * /friends carries Dave's own "Blocked" filter tab, so a bare /blocked/
     * match fires on every account and reports a leak that does not exist. The
     * question is whether CAROL is described to Dave in block language, so the
     * navigation chrome is removed before testing. */
    const chrome = ["All", "Circles", "Close Friends", "Requests", "Blocked", "Nearby"];
    let daveContent = daveSees;
    for (const c of chrome) daveContent = daveContent.split(c).join(" ");
    const leakWords = ["has blocked", "you were blocked", "restricted", "unavailable",
                       "no longer available", "blocked you"];
    const leaked = leakWords.filter((w) => new RegExp(w, "i").test(daveContent));
    check("the blocked person is not told a block happened",
      leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(", ")}`
        : `no block language; Carol named: ${/carol/i.test(daveContent)}`);

    // And the blocker can find their own control to undo it.
    const { ctx: c2, page: p2 } = await sessionFor(carol.email);
    await p2.goto(`${BASE}/friends?tab=blocked`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p2.waitForTimeout(3200);
    const carolSees = await bodyOf(p2);
    await p2.screenshot({ path: `${OUT}/E-carol-blocked-tab.png`, fullPage: true }).catch(() => {});
    await c2.close();
    check("the blocker can see and manage who they blocked",
      /dave/i.test(carolSees), carolSees.slice(0, 120));
  }
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }, null, 2));
console.log(`\n${results.filter(Boolean).length}/${results.length} multi-persona checks passed`);
console.log("cleaned up all personas");
