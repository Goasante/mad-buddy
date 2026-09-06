/**
 * ACCEPTED UPFOR -> COORDINATION, proven on the REAL rendered Home.
 *
 * Reproduces the reported scenario exactly: Jesse owns a Study UpFor, the
 * viewer asks to join, Jesse accepts. Home used to say "You are in" and offer
 * **Open UpFor**, sending the person back into the surface whose question had
 * just been answered. This drives the corrected behaviour end to end -- the
 * message actually opens the right conversation, tapping twice does not create
 * a second one, and conversion hands the moment to Plan authority.
 *
 * Local only. Every fixture is created and removed by this script.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const ROOT = "C:/mb-profile-perf-p1";
const SHOTS = `${ROOT}/.shots/upfor-accepted`;
mkdirSync(SHOTS, { recursive: true });

const env = {};
for (const line of readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
if (!/127\.0\.0\.1|localhost/.test(env.NEXT_PUBLIC_SUPABASE_URL || "")) {
  console.error("HARD STOP: not a local database");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const VIEWER = "4a000000-0000-4000-8000-00000000004a"; // Adjoa, the person on Home
/* The "Jesse" of the bug report. This local fixture identity is named Bediako;
   the NAME is read from the profile at run time rather than hardcoded, because
   asserting a literal would test the seed data instead of the product. */
const JESSE = "4b000000-0000-4000-8000-00000000004b"; // owns the Study UpFor
let ownerFirstName = "";

const LOGIN_EMAIL = "a@v4test.local";
const LOGIN_PASSWORD = "ProofPass123!";

const results = [];
const record = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  results.push({ name, ok, detail });
};

/** A fixture that fails must STOP the run, not silently produce nothing. */
function must(label, { data, error } = {}) {
  if (error) {
    console.error(`HARD STOP: fixture "${label}" failed -- ${error.message}`);
    process.exit(1);
  }
  return data;
}

const ids = { session: null, plan: null, conversation: null };

async function clearFixtures() {
  const { data: sessions } = await admin
    .from("hangout_sessions")
    .select("id")
    .in("owner_id", [VIEWER, JESSE]);
  for (const session of sessions ?? []) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", session.id);
  }
  await admin.from("hangout_requests").delete().in("requester_id", [VIEWER, JESSE]);
  await admin.from("hangout_sessions").delete().in("owner_id", [VIEWER, JESSE]);

  /* Plans this proof converted, plus their chats. */
  const { data: plans } = await admin.from("plans").select("id").in("creator_id", [VIEWER, JESSE]);
  for (const plan of plans ?? []) {
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", plan.id);
    for (const conv of convs ?? []) {
      await admin.from("messages").delete().eq("conversation_id", conv.id);
      await admin.from("conversation_members").delete().eq("conversation_id", conv.id);
      await admin.from("conversations").delete().eq("id", conv.id);
    }
    await admin.from("plan_participants").delete().eq("plan_id", plan.id);
    await admin.from("plans").delete().eq("id", plan.id);
  }

  await admin.from("smart_card_acknowledgements").delete().eq("user_id", VIEWER);
  ids.session = null;
  ids.plan = null;
}

/** Home must be mature or Card A owns the screen and tier 2 renders quiet. */
async function makeHomeMature() {
  await admin.from("activation_milestones").upsert(
    [
      { user_id: VIEWER, milestone: "first_muddy_added" },
      { user_id: VIEWER, milestone: "first_wave_sent" },
      { user_id: VIEWER, milestone: "first_plan_created" }
    ],
    { onConflict: "user_id,milestone" }
  );
}

/** Jesse and the viewer must be Muddies for direct messaging to be allowed. */
async function ensureMuddies() {
  const low = VIEWER < JESSE ? VIEWER : JESSE;
  const high = VIEWER < JESSE ? JESSE : VIEWER;
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null)
    .maybeSingle();
  if (!existing) {
    must("friendship", await admin.from("friendships").insert({ user_one_id: low, user_two_id: high }));
  }
}

/** THE REPORTED SCENARIO: Jesse's Study UpFor, joined and accepted. */
async function fixtureAcceptedStudyUpFor() {
  const session = must(
    "hangout_session",
    await admin
      .from("hangout_sessions")
      .insert({
        owner_id: JESSE,
        activity_type: "study",
        audience_type: "all_muddies",
        status: "active",
        starts_at: new Date(Date.now() - 6e5).toISOString(),
        ends_at: new Date(Date.now() + 72e5).toISOString(),
        max_participants: 4
      })
      .select("id")
      .maybeSingle()
  );
  ids.session = session?.id ?? null;
  if (!ids.session) {
    console.error("HARD STOP: session fixture produced no row");
    process.exit(1);
  }

  must(
    "hangout_request_accepted",
    await admin
      .from("hangout_requests")
      .insert({ hangout_session_id: ids.session, requester_id: VIEWER, status: "accepted" })
  );
  return ids.session;
}

/* --------------------------------------------------------------------- probe */

const browser = await chromium.launch({ headless: true });

async function signedInState() {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).first().fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).first().fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const state = await context.storageState();
  const landed = page.url();
  await context.close();
  return { state, landed };
}

const { state: authState, landed } = await signedInState();
if (landed.includes("/login")) {
  console.error("HARD STOP: login did not succeed; every probe would measure the login page.");
  await browser.close();
  process.exit(1);
}
console.log("signed in, landed on " + landed + "\n");

function newContext({ width = 393, dark = false, textScale = 1 } = {}) {
  return browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    baseURL: "http://127.0.0.1:3000",
    colorScheme: dark ? "dark" : "light",
    storageState: authState,
    ...(textScale !== 1 ? {} : {})
  });
}

async function look(label, { width = 393, dark = false, textScale = 1 } = {}) {
  const context = await newContext({ width, dark });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  if (textScale !== 1) {
    await page.addInitScript((scale) => {
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, textScale);
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });

  const probe = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const doc = document.documentElement;
    const card = [...document.querySelectorAll("article")].find((a) => /YOU'RE IN|YOU ARE IN/i.test(text(a)));
    const actions = card
      ? [...card.querySelectorAll("a,button")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              t: text(el).slice(0, 30),
              tag: el.tagName.toLowerCase(),
              href: el.getAttribute("href"),
              h: Math.round(r.height)
            };
          })
          .filter((a) => a.t)
      : [];
    return {
      cardText: card ? text(card) : "",
      actions,
      nested: card
        ? [...card.querySelectorAll("a,button")].filter((el) => el.querySelector("a,button")).length
        : 0,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth
    };
  });

  await context.close();
  return { ...probe, errors };
}

/** Tap the card's PRIMARY action and report where the browser ended up. */
async function tapPrimary(label, { doubleTap = false } = {}) {
  const context = await newContext({});
  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const primary = page.getByRole("button", { name: /^Message /i }).first();
  await primary.waitFor({ state: "visible", timeout: 15000 });
  if (doubleTap) {
    /* Two taps as fast as the browser allows, without awaiting between them. */
    await Promise.all([primary.click({ force: true }), primary.click({ force: true }).catch(() => {})]);
  } else {
    await primary.click();
  }
  await page.waitForURL((url) => url.pathname.includes("/messages"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
  const url = page.url();
  await context.close();
  return url;
}

async function directConversationCount() {
  const { data } = await admin
    .from("conversations")
    .select("id, direct_key")
    .eq("conversation_type", "direct");
  const key = [VIEWER, JESSE].sort().join(":");
  return (data ?? []).filter((row) => row.direct_key === key).length;
}

/* --------------------------------------------------------------------- run */

console.log("=== ACCEPTED UPFOR -> COORDINATION RUNTIME PROOF ===\n");

await clearFixtures();
await makeHomeMature();
await ensureMuddies();
await fixtureAcceptedStudyUpFor();

{
  const { data: owner } = await admin
    .from("profiles")
    .select("full_name")
    .eq("user_id", JESSE)
    .maybeSingle();
  ownerFirstName = (owner?.full_name || "").split(" ")[0];
  if (!ownerFirstName) {
    console.error("HARD STOP: could not resolve the UpFor owner's name");
    process.exit(1);
  }
  console.log(`the reported "Jesse" is ${ownerFirstName} in local fixtures
`);
}

console.log("--- A. the reported card, at real phone widths ---");
for (const width of [360, 393, 430]) {
  const r = await look(`accepted-${width}`, { width });
  record(`${width}px: no horizontal overflow`, !r.horizontalOverflow, `${r.scrollWidth}/${r.clientWidth}`);
  record(`${width}px: no page errors`, r.errors.length === 0, r.errors.join("; "));
  record(
    `${width}px: says the owner said yes, and that they are studying together`,
    r.cardText.includes(`${ownerFirstName} said yes`) && /studying together/i.test(r.cardText),
    r.cardText.slice(0, 90)
  );
  record(
    `${width}px: primary is Message ${ownerFirstName}, NOT Open UpFor`,
    r.actions[0]?.t === `Message ${ownerFirstName}` && !/Open UpFor/i.test(r.cardText),
    r.actions.map((a) => `${a.tag}:${a.t}`).join(" | ")
  );
  const small = r.actions.filter((a) => a.h > 0 && a.h < 44);
  record(`${width}px: actions >= 44px`, small.length === 0, small.map((a) => `${a.t}:${a.h}`).join(", "));
  record(`${width}px: no nested interactive elements`, r.nested === 0, String(r.nested));
}

const dark = await look("accepted-dark-393", { width: 393, dark: true });
record("dark renders", dark.errors.length === 0 && !dark.horizontalOverflow, dark.errors.join("; "));
const big = await look("accepted-200pct-393", { width: 393, textScale: 2 });
record("200% text: no overflow", !big.horizontalOverflow, `${big.scrollWidth}/${big.clientWidth}`);
record("200% text: actions still present", big.actions.length > 0, `${big.actions.length}`);

console.log("\n--- B. the primary action opens the RIGHT conversation ---");
{
  const shape = await look("accepted-shape-393", { width: 393 });
  const primary = shape.actions[0];
  const secondary = shape.actions[1];
  record(
    "primary is a BUTTON (an authorized action), not a bare link",
    primary?.tag === "button" && !primary?.href,
    `${primary?.tag}:${primary?.t}`
  );
  record(
    "secondary keeps UpFor reachable at the exact session",
    secondary?.t === "View UpFor" && secondary?.href === `/hangout-mode?hangout=${ids.session}`,
    `${secondary?.t} -> ${secondary?.href}`
  );

  const before = await directConversationCount();
  const url = await tapPrimary("accepted-tap-primary");
  record(
    "tapping it opens a specific conversation, not the inbox",
    /\/messages\?conversation=[0-9a-f-]{36}/i.test(url),
    url
  );
  record("and not the UpFor surface", !url.includes("hangout-mode"), url);

  const after = await directConversationCount();
  record(
    "exactly one direct conversation now exists",
    after === 1,
    `before=${before} after=${after}`
  );

  /* IDEMPOTENCE. The canonical action resolves by direct_key, so opening again
     -- including two taps racing each other -- must not create a second row. */
  await tapPrimary("accepted-tap-again");
  const afterRepeat = await directConversationCount();
  record("re-opening does not create a second conversation", afterRepeat === 1, `count=${afterRepeat}`);

  await tapPrimary("accepted-double-tap", { doubleTap: true });
  const afterDouble = await directConversationCount();
  record("a double tap does not create a second conversation", afterDouble === 1, `count=${afterDouble}`);
}

console.log("\n--- C. the secondary still opens that exact UpFor ---");
{
  const context = await newContext({});
  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("link", { name: /^View UpFor$/i }).first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/accepted-view-upfor.png`, fullPage: false });
  const url = page.url();
  const centred = await page
    .evaluate((id) => Boolean(document.getElementById(`hangout-${id}`)), ids.session)
    .catch(() => false);
  await context.close();
  record("View UpFor carries the exact session id", url.includes(`hangout=${ids.session}`), url);
  record("and that session is on the page", centred, String(centred));
}

console.log("\n--- D. conversion hands the moment to Plan authority ---");
{
  /* The canonical lifecycle marks the session converted. Home reads joined
     sessions as ACTIVE only, so the accepted card must simply stop existing --
     no stale coordination card, and no duplicate UpFor + Plan pair. */
  const plan = must(
    "converted_plan",
    await admin
      .from("plans")
      .insert({
        creator_id: JESSE,
        title: "Study session",
        plan_type: "quick",
        status: "confirmed",
        start_at: new Date(Date.now() + 36e5).toISOString()
      })
      .select("id")
      .maybeSingle()
  );
  ids.plan = plan?.id ?? null;
  must(
    "plan_participants",
    await admin.from("plan_participants").insert([
      { plan_id: ids.plan, user_id: JESSE, role: "host", rsvp_status: "going" },
      { plan_id: ids.plan, user_id: VIEWER, role: "participant", rsvp_status: "going" }
    ])
  );
  must(
    "session_converted",
    await admin
      .from("hangout_sessions")
      .update({ status: "converted_to_plan", converted_plan_id: ids.plan })
      .eq("id", ids.session)
  );

  const after = await look("accepted-after-conversion-393", { width: 393 });
  record(
    "the accepted UpFor card is gone after conversion",
    !/said yes/i.test(after.cardText),
    after.cardText.slice(0, 90) || "(no accepted card)"
  );
  record("no page errors after conversion", after.errors.length === 0, after.errors.join("; "));

  const home = await newContext({});
  const page = await home.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600));
  await home.close();
  record(
    "and Home shows no duplicate UpFor + Plan coordination pair",
    !(/said yes/i.test(body) && /Study session/i.test(body)),
    body.slice(0, 90)
  );
}

await clearFixtures();
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? `RUNTIME PROOF: PASS (${results.length}/${results.length})` : `FAILURES: ${failed.length}/${results.length}`}`
);
for (const f of failed) console.log(`  FAIL  ${f.name}  ${f.detail}`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length === 0 ? 0 : 1);
