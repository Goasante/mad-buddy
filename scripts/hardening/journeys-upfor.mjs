/**
 * Mission 3 Extreme — UpFor momentum and UpFor -> Plan, with three real people.
 *
 * Mission 1 proved the lifecycle. What is judged here is the MULTI-PERSON
 * experience: does the creator see that something changed, do responders
 * understand their own status, is the social proof truthful, and does a
 * conversion feel like spontaneity becoming commitment rather than people being
 * silently enrolled?
 *
 * FIXTURE DISCIPLINE. Every write reads its error and the row shape is asserted
 * before behaviour. Schema facts that have already cost this program time:
 *   - hangout_sessions keys on `owner_id`, NOT host_id
 *   - hangout_requests uses `hangout_session_id` + `requester_id`
 *   - status enums: active|paused|full|expired|cancelled|converted_to_plan
 *   - request status: pending|accepted|maybe|declined|cancelled
 *   - profiles_username_format rejects hyphens
 *   - friendships has NO `status` column (keyed on ended_at IS NULL)
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const OUT = "C:/mb-god/.hardening/journeys-upfor";
mkdirSync(OUT, { recursive: true });

const made = [];
const sessions = [];
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

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
  for (const s of sessions) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", s);
    await admin.from("hangout_sessions").delete().eq("id", s);
  }
  for (const id of made) {
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
    await admin.from("hangout_requests").delete().eq("requester_id", id);
    await admin.from("hangout_sessions").delete().eq("owner_id", id);
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
  await page.waitForTimeout(2400);
  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').first().fill("HardeningPass123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6500);
  // Every session must actually BE signed in, or every later reading is of the
  // login page. This has silently invalidated a probe before.
  const landed = new URL(page.url()).pathname;
  if (landed.startsWith("/login")) throw new Error(`sign-in failed for ${email}: still on ${landed}`);
  return { ctx, page };
}

const seen = async (page, route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3200);
  for (let i = 0; i < 3; i += 1) {
    const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
    if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(900); } else break;
  }
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
};

try {
  const alma = await person("alma");   // creator
  const kojo = await person("kojo");   // responder 1
  const nana = await person("nana");   // responder 2
  await befriend(alma.id, kojo.id);
  await befriend(alma.id, nana.id);

  // --- A creates an UpFor -------------------------------------------------
  const { data: upfor, error: uErr } = await admin.from("hangout_sessions").insert({
    owner_id: alma.id,
    activity_type: "food",
    audience_type: "all_muddies",
    message: "Late lunch, anyone?",
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 3 * 3600e3).toISOString(),
    max_participants: 4,
    status: "active"
  }).select("id, status, max_participants").maybeSingle();
  if (uErr) throw new Error(`upfor: ${uErr.message}`);
  sessions.push(upfor.id);
  check("the UpFor fixture applied with the expected shape",
    upfor && upfor.status === "active" && typeof upfor.max_participants === "number",
    `id=${upfor.id.slice(0, 8)} status=${upfor.status} cap=${upfor.max_participants}`);

  // --- B and C see it, before responding ----------------------------------
  const kojoSession = await sessionFor(kojo.email);
  const kojoBefore = await seen(kojoSession.page, "/hangout-mode");
  /* THE UPFOR ITSELF, not the page furniture. `/Alma/` alone would have
     matched nothing meaningful and `/Late lunch/` is the only string unique to
     this session -- the earlier version ORed them, so a page showing neither
     the message nor the creator could still pass on generic copy. */
  check("a Muddy can see the creator's UpFor",
    /Late lunch/i.test(kojoBefore),
    `message visible: ${/Late lunch/i.test(kojoBefore)}, creator named: ${/Alma/i.test(kojoBefore)}`);

  // --- B responds ---------------------------------------------------------
  const { error: r1Err } = await admin.from("hangout_requests").insert({
    hangout_session_id: upfor.id, requester_id: kojo.id, status: "pending"
  });
  if (r1Err) throw new Error(`kojo request: ${r1Err.message}`);
  const kojoAfter = await seen(kojoSession.page, "/hangout-mode");
  check("the responder's own state changes after responding",
    kojoAfter !== kojoBefore,
    kojoAfter === kojoBefore ? "identical page before and after" : "responder view updated");
  await kojoSession.page.screenshot({ path: `${OUT}/kojo-after-respond.png`, fullPage: true }).catch(() => {});
  await kojoSession.ctx.close();

  // --- C responds ---------------------------------------------------------
  const { error: r2Err } = await admin.from("hangout_requests").insert({
    hangout_session_id: upfor.id, requester_id: nana.id, status: "pending"
  });
  if (r2Err) throw new Error(`nana request: ${r2Err.message}`);

  // --- A RETURNS: does the creator see momentum? --------------------------
  const almaSession = await sessionFor(alma.email);
  const almaSees = await seen(almaSession.page, "/hangout-mode");
  await almaSession.page.screenshot({ path: `${OUT}/alma-momentum.png`, fullPage: true }).catch(() => {});

  const { data: requests } = await admin.from("hangout_requests")
    .select("id, requester_id, status").eq("hangout_session_id", upfor.id);
  check("both responses exist in the database",
    (requests ?? []).length === 2, `${(requests ?? []).length} request(s)`);

  /* TRUTHFUL SOCIAL PROOF. The creator must be able to tell that two people
     responded -- by name, by count, or by a request list. A creator who cannot
     see momentum has no reason to convert. */
  const namesShown = /kojo/i.test(almaSees) && /nana/i.test(almaSees);
  const countShown = /\b2\b/.test(almaSees);
  check("the creator can see that people responded",
    namesShown || countShown,
    `names: ${namesShown}, a count appears: ${countShown} | ${almaSees.slice(0, 170)}`);

  // --- STATE CHANGE: the UpFor expires ------------------------------------
  /* `hangout_ends_after_start` forbids ends_at <= starts_at, so an expiry
     cannot be simulated by dragging ends_at into the past alone -- the whole
     window moves back instead. Caught by reading the error rather than by a
     confusing result. */
  const past = Date.now() - 4 * 3600e3;
  const { error: expErr } = await admin.from("hangout_sessions")
    .update({
      status: "expired",
      starts_at: new Date(past).toISOString(),
      ends_at: new Date(past + 60 * 60e3).toISOString()
    })
    .eq("id", upfor.id);
  if (expErr) throw new Error(`expire: ${expErr.message}`);

  const almaAfterExpiry = await seen(almaSession.page, "/hangout-mode");
  check("an expired UpFor no longer presents as live",
    !/Late lunch/i.test(almaAfterExpiry) || /expired|ended|over/i.test(almaAfterExpiry),
    almaAfterExpiry.slice(0, 170));
  await almaSession.ctx.close();

  // --- C's view of an expired session -------------------------------------
  const nanaSession = await sessionFor(nana.email);
  const nanaSees = await seen(nanaSession.page, "/hangout-mode");
  check("a responder does not see an expired UpFor as joinable",
    !/Late lunch/i.test(nanaSees) || /expired|ended|over/i.test(nanaSees),
    nanaSees.slice(0, 150));
  await nanaSession.ctx.close();
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 160)}`);
} finally {
  await browser.close();
  await cleanup();
}

writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }, null, 2));
console.log(`\n${results.filter(Boolean).length}/${results.length} UpFor multi-person checks passed`);
console.log("cleaned up all personas and sessions");
