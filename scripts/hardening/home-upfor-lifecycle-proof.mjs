/**
 * THE WHOLE UPFOR LOOP, on the REAL rendered Home.
 *
 * Two real-phone defects are proved fixed end to end, and both were the same
 * mistake: confusing a STATE with a JOB.
 *
 *   Card A sat on "You've got something on / Open your plan" forever, because
 *   one upcoming Plan short-circuited the whole activation resolver.
 *
 *   Home kept saying "Message Ama" to somebody who had just messaged Ama,
 *   because `myStatus === "accepted"` stays true for the life of the session.
 *
 * The invariant under test, and the reason unit tests are not enough here:
 * HOME MUST ADVANCE WHEN THE HUMAN ADVANCES.
 *
 * Local only. Every fixture is created and removed by this script.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const ROOT = "C:/mb-profile-perf-p1";
const SHOTS = `${ROOT}/.shots/home-upfor-lifecycle`;
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

const VIEWER = "4a000000-0000-4000-8000-00000000004a"; // A, the person on Home
const AMA = "4b000000-0000-4000-8000-00000000004b"; // B, owns the first UpFor
const KOJO = "4c000000-0000-4000-8000-00000000004c"; // C, owns the second

const LOGIN_EMAIL = "a@v4test.local";
const LOGIN_PASSWORD = "ProofPass123!";

const results = [];
const record = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  results.push({ name, ok, detail });
};

/** A fixture that fails must STOP the run, not silently produce nothing. */
function must(label, result) {
  /* A PROMISE IS NOT A RESULT. Passing an un-awaited query here destructures
     `{data, error}` off a Promise, gets undefined for both, and sails past the
     guard -- so the fixture silently does nothing and the probe reports a
     product defect. Catch that shape explicitly rather than trusting a caller
     to remember the await. */
  if (result && typeof result.then === "function") {
    console.error(`HARD STOP: fixture "${label}" was not awaited`);
    process.exit(1);
  }
  const { data, error } = result ?? {};
  if (error) {
    console.error(`HARD STOP: fixture "${label}" failed -- ${error.message}`);
    process.exit(1);
  }
  return data;
}

const ids = { ama: null, kojo: null, plan: null };

async function clearFixtures() {
  const { data: sessions } = await admin
    .from("hangout_sessions")
    .select("id")
    .in("owner_id", [VIEWER, AMA, KOJO]);
  for (const session of sessions ?? []) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", session.id);
  }
  await admin.from("hangout_requests").delete().in("requester_id", [VIEWER, AMA, KOJO]);
  await admin.from("hangout_sessions").delete().in("owner_id", [VIEWER, AMA, KOJO]);

  /* Direct conversations this proof wrote into. */
  for (const other of [AMA, KOJO]) {
    const key = [VIEWER, other].sort().join(":");
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("direct_key", key);
    for (const conv of convs ?? []) {
      await admin.from("messages").delete().eq("conversation_id", conv.id);
      await admin.from("conversation_members").delete().eq("conversation_id", conv.id);
      await admin.from("conversations").delete().eq("id", conv.id);
    }
  }

  const { data: plans } = await admin.from("plans").select("id").in("creator_id", [VIEWER, AMA]);
  for (const plan of plans ?? []) {
    await admin.from("plan_participants").delete().eq("plan_id", plan.id);
    await admin.from("plans").delete().eq("id", plan.id);
  }

  await admin.from("smart_card_acknowledgements").delete().eq("user_id", VIEWER);
  ids.ama = null;
  ids.kojo = null;
  ids.plan = null;
}

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

async function ensureMuddy(other) {
  const low = VIEWER < other ? VIEWER : other;
  const high = VIEWER < other ? other : VIEWER;
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

/** A live UpFor visible to every Muddy. */
async function createUpFor(ownerId, activity) {
  const session = must(
    `upfor_${activity}`,
    await admin
      .from("hangout_sessions")
      .insert({
        owner_id: ownerId,
        activity_type: activity,
        audience_type: "all_muddies",
        status: "active",
        starts_at: new Date(Date.now() - 6e5).toISOString(),
        ends_at: new Date(Date.now() + 72e5).toISOString(),
        max_participants: 4
      })
      .select("id")
      .maybeSingle()
  );
  if (!session?.id) {
    console.error("HARD STOP: UpFor fixture produced no row");
    process.exit(1);
  }
  return session.id;
}

const requestToJoin = async (sessionId) =>
  must(
    "join_request",
    await admin
      .from("hangout_requests")
      .insert({ hangout_session_id: sessionId, requester_id: VIEWER, status: "pending" })
  );

const acceptRequest = (sessionId) =>
  admin
    .from("hangout_requests")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("hangout_session_id", sessionId)
    .eq("requester_id", VIEWER);

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

async function names() {
  const { data } = await admin.from("profiles").select("user_id, full_name").in("user_id", [AMA, KOJO]);
  const byId = new Map((data ?? []).map((p) => [p.user_id, (p.full_name || "").split(" ")[0]]));
  return { ama: byId.get(AMA) || "", kojo: byId.get(KOJO) || "" };
}
const WHO = await names();
if (!WHO.ama || !WHO.kojo) {
  console.error("HARD STOP: could not resolve fixture owner names");
  await browser.close();
  process.exit(1);
}
console.log(`signed in. "Ama" is ${WHO.ama}; "Kojo" is ${WHO.kojo}\n`);

function newContext({ width = 393, dark = false } = {}) {
  return browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    baseURL: "http://127.0.0.1:3000",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: "no-preference",
    storageState: authState
  });
}

async function look(label, { width = 393, dark = false, textScale = 1, reducedMotion = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    baseURL: "http://127.0.0.1:3000",
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    storageState: authState
  });
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
    const articles = [...document.querySelectorAll("article")];
    const EYEBROW =
      /NEEDS YOUR RESPONSE|NEEDS YOUR ANSWER|HAPPENING NOW|STARTING SOON|SAFE ARRIVAL|THIS WEEKEND|COMING UP|GATHERING|MILESTONE|YOU BOTH CONNECTED|YOU'RE CHECKED IN|BEING DECIDED|TODAY|FINISH SETUP|YOU'RE IN|YOU ARE IN|UPFOR/i;
    const card = articles.find((a) => EYEBROW.test(text(a)));
    const actions = card
      ? [...card.querySelectorAll("a,button")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { t: text(el).slice(0, 32), tag: el.tagName.toLowerCase(), h: Math.round(r.height) };
          })
          .filter((a) => a.t)
      : [];
    return {
      cardText: card ? text(card) : "",
      actions,
      nested: card
        ? [...card.querySelectorAll("a,button")].filter((el) => el.querySelector("a,button")).length
        : 0,
      bodySample: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth
    };
  });

  await context.close();
  return { ...probe, errors };
}

function assertLayout(label, r) {
  record(`${label}: no horizontal overflow`, !r.horizontalOverflow, `${r.scrollWidth}/${r.clientWidth}`);
  record(`${label}: no page errors`, r.errors.length === 0, r.errors.join("; "));
  const small = r.actions.filter((a) => a.h > 0 && a.h < 44);
  record(`${label}: actions >= 44px`, small.length === 0, small.map((a) => `${a.t}:${a.h}`).join(", "));
  record(`${label}: no nested interactive elements`, r.nested === 0, String(r.nested));
}

/* --------------------------------------------------------------------- run */

console.log("=== HOME UPFOR LIFECYCLE RUNTIME PROOF ===\n");

await clearFixtures();
await makeHomeMature();
await ensureMuddy(AMA);
await ensureMuddy(KOJO);

console.log("--- A. Card A is no longer stuck on an upcoming Plan ---");
{
  /* The exact reported shape: a set-up person with a Plan on the way. Card A
     used to sit on "Open your plan" forever; it must now step aside. */
  const plan = must(
    "upcoming_plan",
    await admin
      .from("plans")
      .insert({
        creator_id: AMA,
        title: "Saturday Brunch",
        plan_type: "quick",
        status: "confirmed",
        start_at: new Date(Date.now() + 30 * 36e5).toISOString()
      })
      .select("id")
      .maybeSingle()
  );
  ids.plan = plan?.id ?? null;
  must(
    "plan_participants",
    await admin.from("plan_participants").insert([
      { plan_id: ids.plan, user_id: AMA, role: "host", rsvp_status: "going" },
      { plan_id: ids.plan, user_id: VIEWER, role: "participant", rsvp_status: "going" }
    ])
  );

  const r = await look("cardA-with-plan-393");
  assertLayout("Card A with a Plan", r);
  record(
    "Card A no longer shows the stuck Open-your-plan billboard",
    !/You've got something on/i.test(r.bodySample),
    r.bodySample.slice(0, 110)
  );
  record(
    "and the Plan is still on Home, in the surfaces that own it",
    /Saturday Brunch/i.test(r.bodySample),
    r.bodySample.match(/Saturday Brunch/i) ? "named on Home" : "MISSING"
  );
  record(
    "no duplicate Plan hero (Open your plan appears at most once)",
    (r.bodySample.match(/Open your plan/gi) ?? []).length === 0,
    String((r.bodySample.match(/Open your plan/gi) ?? []).length)
  );
}

console.log("\n--- B. a Muddy puts something out: discovery ---");
{
  ids.ama = await createUpFor(AMA, "coffee");
  for (const width of [360, 393, 430]) {
    const r = await look(`discovery-${width}`, { width });
    assertLayout(`${width}px discovery`, r);
    record(
      `${width}px: Home surfaces the Muddy's live UpFor`,
      r.cardText.includes(`${WHO.ama} is UpFor coffee`),
      r.cardText.slice(0, 90)
    );
    record(
      `${width}px: and offers to see it`,
      r.actions.some((a) => a.t === "See UpFor"),
      r.actions.map((a) => a.t).join(" | ")
    );
  }
  const dark = await look("discovery-dark-393", { dark: true });
  record("dark renders", dark.errors.length === 0 && !dark.horizontalOverflow, dark.errors.join("; "));
  const big = await look("discovery-200pct-393", { textScale: 2 });
  record("200% text: no overflow", !big.horizontalOverflow, `${big.scrollWidth}/${big.clientWidth}`);
  const rm = await look("discovery-reduced-motion-393", { reducedMotion: true });
  record("reduced motion renders", rm.errors.length === 0, rm.errors.join("; "));
}

console.log("\n--- C. the viewer asks to join: waiting ---");
{
  await requestToJoin(ids.ama);
  const r = await look("pending-393");
  assertLayout("pending", r);
  record(
    "Home advances to the waiting state",
    /Waiting on them/i.test(r.cardText),
    r.cardText.slice(0, 90)
  );
  record(
    "and stops presenting it as an untouched opportunity",
    !r.cardText.includes(`${WHO.ama} is UpFor coffee`) || /Waiting on them/i.test(r.cardText),
    r.cardText.slice(0, 90)
  );
}

console.log("\n--- D. the owner says yes: coordination ---");
{
  await acceptRequest(ids.ama);
  const r = await look("accepted-393");
  assertLayout("accepted", r);
  record("Home advances to coordination", /said yes/i.test(r.cardText), r.cardText.slice(0, 90));
  record(
    `and offers Message ${WHO.ama}`,
    r.actions.some((a) => a.t === `Message ${WHO.ama}`),
    r.actions.map((a) => a.t).join(" | ")
  );
}

console.log("\n--- E. opening the chat is NOT completion ---");
{
  const context = await newContext();
  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: new RegExp(`^Message ${WHO.ama}$`, "i") }).first().click();
  await page.waitForURL((url) => url.pathname.includes("/messages"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const opened = page.url();
  await page.screenshot({ path: `${SHOTS}/opened-chat.png`, fullPage: false });
  await context.close();
  record("the tap opens a specific conversation", /conversation=[0-9a-f-]{36}/i.test(opened), opened);

  const still = await look("accepted-after-open-393");
  record(
    "returning Home, the coordination card is STILL offered",
    still.actions.some((a) => a.t === `Message ${WHO.ama}`),
    still.cardText.slice(0, 90)
  );
}

console.log("\n--- F. the viewer actually sends: the job completes ---");
{
  /* SENT THROUGH THE SERVICE, not typed into the thread UI.
   *
   * The composer could not be driven here, and the reason is a PRE-EXISTING
   * messaging behaviour this tranche does not touch: messages-page-v4 selects a
   * conversation only if it appears in the inbox list (`conversations.find`),
   * and a brand-new direct conversation with zero messages is not in that list
   * yet -- so /messages?conversation=<id> renders "Choose a chat". Verified
   * against main; this branch changes no file under components/messages or
   * lib/messaging. Reported as a separate finding rather than fixed here.
   *
   * What matters for THIS proof is unchanged: the completion evidence must be a
   * real, viewer-authored, non-system, non-deleted message in the canonical
   * direct conversation, created after acceptance -- exactly what the reader
   * looks for. Home is then measured exactly as a person would see it.
   */
  const key = [VIEWER, AMA].sort().join(":");
  const { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("direct_key", key)
    .maybeSingle();
  record("the tap created the canonical direct conversation", Boolean(conv?.id), conv?.id ?? "MISSING");

  must(
    "viewer_message",
    await admin.from("messages").insert({
      conversation_id: conv?.id,
      sender_id: VIEWER,
      text_content: "See you at the cafe!",
      message_type: "text"
    })
  );

  const { data: confirmed } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conv?.id ?? "")
    .eq("sender_id", VIEWER)
    .neq("message_type", "system")
    .is("deleted_at", null);
  record(
    "a real viewer-authored message now exists",
    (confirmed ?? []).length > 0,
    `${(confirmed ?? []).length} message(s)`
  );

  const after = await look("after-message-393");
  assertLayout("after message", after);
  record(
    `HOME NO LONGER SAYS "Message ${WHO.ama}"`,
    !after.actions.some((a) => a.t === `Message ${WHO.ama}`) &&
      !after.cardText.includes(`Message ${WHO.ama}`),
    after.cardText.slice(0, 100)
  );
  record(
    "and the accepted coordination card is gone",
    !/said yes/i.test(after.cardText),
    after.cardText.slice(0, 90)
  );
}


console.log("\n--- G. the next opportunity takes the slot ---");
{
  ids.kojo = await createUpFor(KOJO, "gym");
  const r = await look("next-opportunity-393");
  assertLayout("next opportunity", r);
  record(
    `Home surfaces ${WHO.kojo}'s new UpFor`,
    r.cardText.includes(`${WHO.kojo} is UpFor gym`),
    r.cardText.slice(0, 90)
  );
  record(
    `and no stale ${WHO.ama} coordination card remains`,
    !r.cardText.includes(`Message ${WHO.ama}`),
    r.cardText.slice(0, 90)
  );
}

console.log("\n--- H. ownership boundaries still hold ---");
{
  const r = await look("boundaries-393");
  record(
    "proximity stays NearbyHero's: no distance or coordinates on Home",
    !/\b\d+(\.\d+)?\s?(m|km|meters|metres|miles)\b/i.test(r.bodySample) &&
      !/\b\d+\.\d{4,}\b/.test(r.bodySample),
    ""
  );

  /* Safe Arrival must still take absolute priority over every UpFor state. */
  const journey = must(
    "safe_arrival",
    await admin
      .from("safe_arrival_sessions")
      .insert({
        traveller_id: VIEWER,
        destination_label: "Lifecycle proof",
        expected_arrival_at: new Date(Date.now() + 72e5).toISOString(),
        status: "active"
      })
      .select("id")
      .maybeSingle()
  );
  const safety = await look("safe-arrival-priority-393");
  record(
    "Safe Arrival still outranks every UpFor card",
    /SAFE ARRIVAL/i.test(safety.cardText),
    safety.cardText.slice(0, 90)
  );
  if (journey?.id) await admin.from("safe_arrival_sessions").delete().eq("id", journey.id);
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
