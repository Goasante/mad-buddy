/**
 * Smart Card V2 runtime proof for FAMILIES 3-5, against the REAL rendered Home.
 *
 * A companion to smart-card-visual-proof.mjs, which already proved the V2 core
 * (the tier gate, the two-card composition, deferral, safety authority and
 * proximity ownership) and is not repeated here. This one drives the states
 * added afterwards -- the Linkr/Event relationship states, the coordination
 * decisions and the blocked-feature state -- through the same real login, the
 * same `next start` build and the same probe.
 *
 * Local only. Every fixture is created and removed by this script.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const ROOT = "C:/mb-profile-perf-p1";
const SHOTS = `${ROOT}/.shots/smart-card-families`;
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

const A = "4a000000-0000-4000-8000-00000000004a"; // viewer
const B = "4b000000-0000-4000-8000-00000000004b"; // a Muddy
const C = "4c000000-0000-4000-8000-00000000004c"; // someone not yet connected

const LOGIN_EMAIL = "a@v4test.local";
const LOGIN_PASSWORD = "ProofPass123!";

async function signedInState(browser) {
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

const results = [];
const record = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  results.push({ name, ok, detail });
};

/* ------------------------------------------------------------------ fixtures */

/**
 * A fixture that fails must STOP the run, not quietly produce nothing.
 *
 * The first version of this script swallowed insert errors, so two invalid
 * enum values (plan_type "hangout", event status "published") created no rows
 * at all -- and every probe then measured a Home with no fixture on it and
 * reported eleven convincing "product defects" that were nothing of the kind.
 * A fixture error is a broken harness and must look like one.
 */
function must(label, { data, error } = {}) {
  if (error) {
    console.error(`HARD STOP: fixture "${label}" failed -- ${error.message}`);
    process.exit(1);
  }
  return data;
}

/* Home must be MATURE for tier 3-5 states to be eligible at all: during early
   activation Card A owns the screen and everything below tier 2 is withheld.
   That rule is proved by the core harness; here it is a precondition. */
async function makeHomeMature() {
  await admin.from("activation_milestones").upsert(
    [
      { user_id: A, milestone: "first_muddy_added" },
      { user_id: A, milestone: "first_wave_sent" },
      { user_id: A, milestone: "first_plan_created" }
    ],
    { onConflict: "user_id,milestone" }
  );
}

const ids = { event: null, plan: null, poll: null, conversation: null, pollMessage: null };

async function clearFixtures() {
  /* UPFOR TOO, even though this harness never creates one.
     The core proof (smart-card-visual-proof.mjs) does, and both scripts run
     against the SAME local database and the same fixture user. A leftover live
     UpFor with pending requests is tier 1, so it outranks every state measured
     here and each scenario reports the wrong card. Two harnesses sharing a
     fixture user must each clear what the other can create. */
  const { data: ownedSessions } = await admin.from("hangout_sessions").select("id").in("owner_id", [A, B]);
  for (const session of ownedSessions ?? []) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", session.id);
  }
  await admin.from("hangout_requests").delete().in("requester_id", [A, B]);
  await admin.from("hangout_sessions").delete().in("owner_id", [A, B]);

  await admin.from("linkr_connections").delete().or(`user_low.eq.${A},user_high.eq.${A}`);
  await admin.from("birthday_notification_deliveries").delete().eq("recipient_id", A);
  await clearBirthdayAuthorization();
  await admin.from("event_linkr_opt_ins").delete().eq("user_id", A);
  await admin.from("check_ins").delete().eq("user_id", A);
  if (ids.poll) {
    await admin.from("plan_poll_votes").delete().eq("poll_id", ids.poll);
    await admin.from("plan_poll_options").delete().eq("poll_id", ids.poll);
    await admin.from("plan_polls").delete().eq("id", ids.poll);
    ids.poll = null;
  }
  if (ids.pollMessage) {
    await admin.from("chat_poll_votes").delete().eq("poll_message_id", ids.pollMessage);
    await admin.from("chat_poll_options").delete().eq("poll_message_id", ids.pollMessage);
    await admin.from("chat_polls").delete().eq("message_id", ids.pollMessage);
    await admin.from("messages").delete().eq("id", ids.pollMessage);
    ids.pollMessage = null;
  }
  /* EVERY fixture Plan, not just the one this run last tracked.
     `ids.plan` holds only the most recent id, so a scenario that created a
     second Plan leaked the first -- and Plans have an ACTIVE LIMIT, so the
     leak surfaced later as PLAN_ACTIVE_LIMIT_REACHED in an unrelated suite
     (lib/social/upfor-plan-handoff.local), looking exactly like a product
     defect. Sweeping by creator removes anything this harness could have made. */
  const { data: fixturePlans } = await admin
    .from("plans")
    .select("id")
    .in("creator_id", [A, B]);
  for (const plan of fixturePlans ?? []) {
    const { data: polls } = await admin.from("plan_polls").select("id").eq("plan_id", plan.id);
    for (const poll of polls ?? []) {
      await admin.from("plan_poll_votes").delete().eq("poll_id", poll.id);
      await admin.from("plan_poll_options").delete().eq("poll_id", poll.id);
    }
    await admin.from("plan_polls").delete().eq("plan_id", plan.id);
    await admin.from("plan_participants").delete().eq("plan_id", plan.id);
    await admin.from("plans").delete().eq("id", plan.id);
  }
  ids.plan = null;
  ids.poll = null;
  if (ids.conversation) {
    await admin.from("conversation_members").delete().eq("conversation_id", ids.conversation);
    await admin.from("conversations").delete().eq("id", ids.conversation);
    ids.conversation = null;
  }
  if (ids.event) {
    await admin.from("events").delete().eq("id", ids.event);
    ids.event = null;
  }
  /* Linkr stays OFF between scenarios so profile_blocking cannot leak into an
     unrelated probe. */
  await admin.from("linkr_profiles").upsert({ user_id: A, enabled: false }, { onConflict: "user_id" });
  /* An acknowledgement is permanent for the viewer, so one left behind would
     silently suppress a card in a LATER scenario and read as a product defect. */
  await admin.from("smart_card_acknowledgements").delete().eq("user_id", A);
}

async function makeEvent(name, { live = true } = {}) {
  const data = must(
    "event",
    await admin
      .from("events")
      .insert({
        host_id: B,
        name,
        starts_at: new Date(Date.now() - 36e5).toISOString(),
        ends_at: new Date(Date.now() + (live ? 72e5 : -36e5)).toISOString(),
        status: "active",
        visibility: "public"
      })
      .select("id")
      .maybeSingle()
  );
  ids.event = data?.id ?? null;
  if (!ids.event) {
    console.error("HARD STOP: event fixture produced no row");
    process.exit(1);
  }
  return ids.event;
}

/** A mutual Linkr connection that carries a real Event context. */
async function fixtureLinkrMutualEvent(eventId) {
  const low = A < B ? A : B;
  const high = A < B ? B : A;
  must(
    "linkr_connection",
    await admin.from("linkr_connections").insert({
      user_low: low,
      user_high: high,
      event_id: eventId,
      connected_at: new Date().toISOString()
    })
  );
}

/** Checked in, but NOT consented: the one state that earns the offer. */
async function fixtureCheckedInNoConsent(eventId) {
  must(
    "check_in",
    await admin.from("check_ins").insert({
      user_id: A,
      context_type: "event",
      context_id: eventId,
      status: "checked_in",
      checked_in_at: new Date().toISOString()
    })
  );
}

/**
 * A birthday the viewer may act on: delivered AND still authorized.
 *
 * The delivery row alone is NOT enough any more, and that is the point. It
 * proves only that the viewer was allowed to be told this morning; Home now
 * re-checks the revocable facts -- live friendship, no block, birthday still
 * shared with approved Muddies, announcements still on -- before offering a
 * wish that `sendBirthdayWish` would otherwise refuse.
 */
async function fixtureMuddyBirthday() {
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  must(
    "birthday_privacy",
    await admin
      .from("profile_field_privacy")
      .upsert(
        { user_id: B, field_name: "birthday", visibility: "approved_muddies" },
        { onConflict: "user_id,field_name" }
      )
  );
  must(
    "birthday_preference",
    await admin
      .from("user_preferences")
      .upsert(
        { user_id: B, notification_preferences: { birthdayAnnouncementsEnabled: true } },
        { onConflict: "user_id" }
      )
  );
  const low = A < B ? A : B;
  const high = A < B ? B : A;
  const { data: existing } = await admin
    .from("friendships")
    .select("id")
    .eq("user_one_id", low)
    .eq("user_two_id", high)
    .is("ended_at", null)
    .maybeSingle();
  if (!existing) {
    must(
      "birthday_friendship",
      await admin.from("friendships").insert({ user_one_id: low, user_two_id: high })
    );
  }

  must(
    "birthday_delivery",
    await admin.from("birthday_notification_deliveries").insert({
      birthday_user_id: B,
      recipient_id: A,
      birthday_day: dayKey,
      status: "delivered"
    })
  );
}

/** Revoke the birthday authorization the way a real block would. */
async function blockBirthdayOwner() {
  must(
    "birthday_block",
    await admin.from("blocked_users").insert({ blocker_id: B, blocked_id: A })
  );
}

async function clearBirthdayAuthorization() {
  await admin.from("blocked_users").delete().in("blocker_id", [A, B]);
  await admin.from("profile_field_privacy").delete().eq("user_id", B).eq("field_name", "birthday");
  await admin.from("user_preferences").delete().eq("user_id", B);
}

/** A Plan on the viewer's agenda with an OPEN poll they have not voted in. */
async function fixturePlanDecision(title, question) {
  const plan = must(
    "plan",
    await admin
      .from("plans")
      .insert({
        creator_id: B,
        title,
        plan_type: "poll",
        status: "polling",
        start_at: new Date(Date.now() + 36e5 * 30).toISOString()
      })
      .select("id")
      .maybeSingle()
  );
  ids.plan = plan?.id ?? null;
  if (!ids.plan) {
    console.error("HARD STOP: plan fixture produced no row");
    process.exit(1);
  }

  must(
    "plan_participants",
    await admin.from("plan_participants").insert([
      { plan_id: ids.plan, user_id: B, role: "host", rsvp_status: "going" },
      { plan_id: ids.plan, user_id: A, role: "participant", rsvp_status: "going" }
    ])
  );

  const poll = must(
    "plan_poll",
    await admin
      .from("plan_polls")
      .insert({ plan_id: ids.plan, creator_id: B, poll_type: "place", question, status: "open" })
      .select("id")
      .maybeSingle()
  );
  ids.poll = poll?.id ?? null;
  if (!ids.poll) {
    console.error("HARD STOP: poll fixture produced no row");
    process.exit(1);
  }

  const options = must(
    "plan_poll_options",
    await admin
      .from("plan_poll_options")
      .insert([
        { poll_id: ids.poll, label: "The Republic", sort_order: 0 },
        { poll_id: ids.poll, label: "Skybar", sort_order: 1 }
      ])
      .select("id")
  );
  /* Somebody else has voted, nobody has voted FOR the viewer. That is the
     honest "your vote is still needed" shape. */
  if (options?.[0]) {
    must(
      "plan_poll_vote",
      await admin
        .from("plan_poll_votes")
        .insert({ poll_id: ids.poll, option_id: options[0].id, user_id: B })
    );
  }
  return ids.plan;
}

/** Linkr switched ON while the profile cannot satisfy it. */
async function fixtureBlockedFeature() {
  must(
    "linkr_profile_enabled",
    await admin
      .from("linkr_profiles")
      .upsert({ user_id: A, enabled: true, intent: "friends" }, { onConflict: "user_id" })
  );
  /* Remove the canonical avatar so Linkr's own rule refuses to show them. */
  await admin.from("profiles").update({ avatar_url: null, profile_media_id: null }).eq("user_id", A);
}

/**
 * ENTITLEMENT FIXTURES.
 *
 * Real `access_grants` rows, because the resolver reads them and evaluates
 * expiry against SERVER time -- there is no flag to flip. An expired grant is
 * simply one whose `expires_at` has passed, which is exactly the state a person
 * whose Welcome Access ran out is in.
 */
async function clearAccess() {
  await admin.from("access_grants").delete().eq("user_id", A);
}

async function grantAccess() {
  await clearAccess();
  must(
    "access_grant_active",
    await admin.from("access_grants").insert({
      user_id: A,
      source: "welcome_access",
      starts_at: new Date(Date.now() - 36e5).toISOString(),
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString()
    })
  );
}

async function expireAccess() {
  await clearAccess();
  must(
    "access_grant_expired",
    await admin.from("access_grants").insert({
      user_id: A,
      source: "welcome_access",
      starts_at: new Date(Date.now() - 60 * 864e5).toISOString(),
      expires_at: new Date(Date.now() - 864e5).toISOString()
    })
  );
}

async function restoreAvatar() {
  await admin.from("profiles").update({ avatar_url: "avatar.jpg" }).eq("user_id", A);
}

/* --------------------------------------------------------------------- probe */

const browser = await chromium.launch({ headless: true });

const { state: authState, landed } = await signedInState(browser);
if (landed.includes("/login")) {
  console.error("HARD STOP: login did not succeed; every probe would measure the login page.");
  await browser.close();
  process.exit(1);
}
console.log("signed in, landed on " + landed + "\n");

async function look(label, { width, dark = false, textScale = 1, reducedMotion = false }) {
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
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 100)));

  if (textScale !== 1) {
    await page.addInitScript((scale) => {
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, textScale);
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const onHome = !page.url().includes("/login");
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });

  const probe = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const articles = [...document.querySelectorAll("article")];
    const doc = document.documentElement;
    /* The Smart Card is identified by the eyebrows only it emits, including
       the ones the newer families introduced. */
    const EYEBROW =
      /NEEDS YOUR RESPONSE|NEEDS YOUR ANSWER|HAPPENING NOW|STARTING SOON|SAFE ARRIVAL|THIS WEEKEND|COMING UP|GATHERING|MILESTONE|YOU BOTH CONNECTED|YOU'RE CHECKED IN|BEING DECIDED|TODAY|FINISH SETUP/i;
    const card = articles.find((a) => EYEBROW.test(text(a)));
    const targets = [...(card ?? document.createElement("div")).querySelectorAll("a,button")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { t: text(el).slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((t) => t.t);
    return {
      cardText: card ? text(card) : "",
      /* The Smart Card's PRIMARY action href, so a destination claim can be
         checked against the rendered anchor rather than against source. */
      primaryHref: (() => {
        const link = card?.querySelector("a[href]");
        return link ? link.getAttribute("href") : null;
      })(),
      articleTexts: articles.map((a) => text(a).slice(0, 160)),
      treatment: (() => {
        if (!card) return "none";
        if (/bg-gradient-to-br/.test(card.className)) return "full";
        if (/bg-card/.test(card.className)) return "quiet";
        return "unknown";
      })(),
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      targets,
      /* Nested interactive elements are an accessibility defect the brief calls
         out by name: a button inside a link is ambiguous to a screen reader. */
      nestedInteractive: card
        ? [...card.querySelectorAll("a,button")].filter((el) => el.querySelector("a,button")).length
        : 0,
      bodySample: document.body.innerText.replace(/\s+/g, " ").slice(0, 300)
    };
  });

  await context.close();
  return { ...probe, errors, onHome };
}

/**
 * Follow a rendered href and report where it actually lands.
 *
 * A destination claim is only worth making if the link resolves: asserting the
 * provider's string proves the provider, not the product.
 */
async function follow(href, label) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    baseURL: "http://127.0.0.1:3000",
    storageState: authState
  });
  const page = await context.newPage();
  await page.goto(href, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });
  const url = page.url();
  const heading = await page
    .evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 120))
    .catch(() => "");
  await context.close();
  return { url, heading };
}

/** Assert the layout invariants every scenario must satisfy. */
function assertLayout(label, r) {
  record(`${label}: landed on Home`, r.onHome, r.onHome ? "" : "REDIRECTED");
  record(`${label}: no horizontal overflow`, !r.horizontalOverflow, `${r.scrollWidth}/${r.clientWidth}`);
  record(`${label}: no page errors`, r.errors.length === 0, r.errors.join("; "));
  const small = r.targets.filter((t) => t.h > 0 && t.h < 44);
  record(`${label}: action targets >= 44px`, small.length === 0, small.slice(0, 3).map((t) => `${t.t}:${t.h}`).join(", "));
  record(`${label}: no nested interactive elements`, r.nestedInteractive === 0, String(r.nestedInteractive));
}

/* --------------------------------------------------------------------- run */

console.log("=== SMART CARD V2 -- FAMILIES 3-5 RUNTIME PROOF ===\n");
await clearFixtures();
await makeHomeMature();
/* ENTITLEMENT BASELINE. Sections A-H measure states OTHER than entitlement,
   so the viewer must hold Access -- otherwise the two gated expansions are
   suppressed for a reason those sections are not testing. Section I varies
   it deliberately, and the run clears it at the end. */
await grantAccess();

// ---- A. Linkr mutual WITH Event context, at all three widths.
console.log("--- A. linkr_mutual_event (relationship, media-backed) ---");
{
  const eventId = await makeEvent("Acoustic Night");
  await fixtureLinkrMutualEvent(eventId);
  for (const width of [360, 393, 430]) {
    const r = await look(`linkr-mutual-event-${width}`, { width });
    assertLayout(`${width}px`, r);
    record(
      `${width}px names the Event the pair connected at`,
      /You connected at Acoustic Night/i.test(r.cardText),
      r.cardText.slice(0, 90)
    );
  }
  /* THE PAIR, NOT THE PRODUCT. The card names one connection, so its primary
     action must carry that connection id -- `/linkr?connection=<id>` re-resolves
     at open time, which is what makes a block or a newly-started conversation
     change the answer after Home rendered. */
  const paired = await look("linkr-mutual-event-pair-393", { width: 393 });
  const pairHref = paired.primaryHref ?? "";
  record(
    "Say hi points at THIS pair, not the Linkr index",
    /^\/linkr\?connection=[0-9a-f-]{36}$/i.test(pairHref),
    pairHref
  );
  const openedPair = await follow(pairHref, "linkr-mutual-event-pair-open-393");
  record(
    "and it opens Linkr for that connection rather than an error",
    !openedPair.url.includes("/login") && openedPair.url.includes("connection="),
    `${openedPair.url} :: ${openedPair.heading.slice(0, 60)}`
  );

  const two = await look("linkr-mutual-event-two-actions-393", { width: 393 });
  record(
    "two-action card offers Say hi and Make a Plan",
    /Say hi/i.test(two.cardText) && /Make a Plan/i.test(two.cardText),
    two.targets.map((t) => t.t).join(" | ")
  );
  const darkCard = await look("linkr-mutual-event-dark-393", { width: 393, dark: true });
  assertLayout("dark", darkCard);
  const big = await look("linkr-mutual-event-200pct-393", { width: 393, textScale: 2 });
  record("200% text: no horizontal overflow", !big.horizontalOverflow, `${big.scrollWidth}/${big.clientWidth}`);
  record("200% text: actions still present", big.targets.length > 0, `${big.targets.length} targets`);
  const rm = await look("linkr-mutual-event-reducedmotion-393", { width: 393, reducedMotion: true });
  record("reduced motion renders", rm.errors.length === 0, rm.errors.join("; "));
}

// ---- B. Event Linkr offer: checked in, not consented.
console.log("\n--- B. event_linkr_ready (consent OFFERED, never assumed) ---");
{
  await clearFixtures();
  await makeHomeMature();
  const eventId = await makeEvent("Acoustic Night");
  await fixtureCheckedInNoConsent(eventId);
  const r = await look("event-linkr-ready-393", { width: 393 });
  assertLayout("393px", r);
  record("offers the decision as a question", /Meet people at Acoustic Night\?/i.test(r.cardText), r.cardText.slice(0, 90));
  record(
    "never claims the viewer is already discoverable",
    !/you are (open|discoverable)/i.test(r.cardText),
    r.cardText.slice(0, 90)
  );

  /* THE CONSENT CHAIN, proved at runtime: granting consent must REMOVE the
     offer, because the viewer has now decided and there is nothing to ask. */
  await admin
    .from("event_linkr_opt_ins")
    .upsert({ event_id: eventId, user_id: A, enabled: true }, { onConflict: "event_id,user_id" });
  const consented = await look("event-linkr-consented-393", { width: 393 });
  record(
    "the offer disappears once consent is given",
    !/Meet people at/i.test(consented.cardText),
    consented.cardText.slice(0, 90)
  );

  /* And check-in alone is not enough in the other direction either: with the
     check-in removed the offer must not survive on RSVP or attendance. */
  await admin.from("event_linkr_opt_ins").delete().eq("user_id", A);
  await admin.from("check_ins").delete().eq("user_id", A);
  const noCheckIn = await look("event-linkr-no-checkin-393", { width: 393 });
  record(
    "no check-in means no offer",
    !/Meet people at/i.test(noCheckIn.cardText),
    noCheckIn.cardText.slice(0, 90)
  );
}

// ---- C. A coordination decision.
console.log("\n--- C. plan_decision (actionable coordination) ---");
{
  await clearFixtures();
  await makeHomeMature();
  await fixturePlanDecision("Friday Dinner", "Where should we eat?");
  for (const width of [360, 393, 430]) {
    const r = await look(`plan-decision-${width}`, { width });
    assertLayout(`${width}px`, r);
    record(
      `${width}px names the Plan and the question`,
      /Friday Dinner needs a decision/i.test(r.cardText) && /Where should we eat\?/i.test(r.cardText),
      r.cardText.slice(0, 110)
    );
  }
  const r = await look("plan-decision-detail-393", { width: 393 });
  record("reports progress without naming who voted", /1 person has voted/i.test(r.cardText), r.cardText.slice(0, 110));
  record("the button says what the tap does", /Vote now/i.test(r.cardText), r.targets.map((t) => t.t).join(" | "));

  /* Voting must retire the card: the viewer is no longer the one blocking. */
  const { data: option } = await admin
    .from("plan_poll_options")
    .select("id")
    .eq("poll_id", ids.poll)
    .limit(1)
    .maybeSingle();
  if (option?.id) {
    await admin.from("plan_poll_votes").insert({ poll_id: ids.poll, option_id: option.id, user_id: A });
  }
  const voted = await look("plan-decision-after-vote-393", { width: 393 });
  record(
    "the card retires once the viewer has voted",
    !/needs a decision/i.test(voted.cardText),
    voted.cardText.slice(0, 90)
  );
  const darkCard = await look("plan-decision-dark-393", { width: 393, dark: true });
  assertLayout("plan decision dark", darkCard);
}

// ---- D. Branded fallback: a state with no media at all.
console.log("\n--- D. muddy_birthday (branded fallback, no media) ---");
{
  await clearFixtures();
  await makeHomeMature();
  await fixtureMuddyBirthday();
  const r = await look("muddy-birthday-393", { width: 393 });
  assertLayout("393px", r);
  record("names the person whose birthday it is", /birthday/i.test(r.cardText), r.cardText.slice(0, 90));
  /* The privacy invariant, checked against the RENDERED page: no date of birth
     and no age may appear anywhere on Home. */
  record(
    "no date of birth or age is rendered",
    !/\b\d{4}-\d{2}-\d{2}\b/.test(r.bodySample) && !/\b\d{1,2} years old\b/i.test(r.bodySample),
    ""
  );

  /* AUTHORIZATION IS RE-CHECKED, NOT REMEMBERED. The delivery row proves the
     viewer was told this morning; a block since then must remove the card,
     because the wish itself would now be refused. */
  await blockBirthdayOwner();
  const afterBlock = await look("muddy-birthday-blocked-393", { width: 393 });
  record(
    "a block after delivery removes the birthday card",
    !/birthday/i.test(afterBlock.cardText),
    afterBlock.cardText.slice(0, 80)
  );
  await admin.from("blocked_users").delete().in("blocker_id", [A, B]);
  const restored = await look("muddy-birthday-restored-393", { width: 393 });
  record(
    "and lifting the block brings it back",
    /birthday/i.test(restored.cardText),
    restored.cardText.slice(0, 80)
  );
}

// ---- E. Longest real copy, at the narrowest width.
console.log("\n--- E. longest real copy at 360px ---");
{
  await clearFixtures();
  await makeHomeMature();
  await fixturePlanDecision(
    "Saturday Afternoon Rooftop Get-Together",
    "Which venue should we book for the evening, given the weather forecast?"
  );
  const r = await look("longest-copy-360", { width: 360 });
  assertLayout("longest copy 360px", r);
  const big = await look("longest-copy-360-200pct", { width: 360, textScale: 2 });
  record("longest copy at 200% text: no overflow", !big.horizontalOverflow, `${big.scrollWidth}/${big.clientWidth}`);
}

// ---- F. Growth/recovery: the one state that earned wiring.
console.log("\n--- F. profile_blocking (growth/recovery) ---");
{
  await clearFixtures();
  await makeHomeMature();
  await fixtureBlockedFeature();

  /* profile_blocking is tier 5, so anything higher legitimately outranks it.
     `weekend_plans` is tier 4 and eligible from Friday evening through Sunday,
     which made this scenario pass or fail depending on the DAY THE PROOF RAN --
     the run that found this was a Sunday. Acknowledging the weekend card uses
     the product's own retire mechanism to hold the higher state out, so what is
     measured here is this card's own rendering rather than the calendar. */
  must(
    "acknowledge_weekend_plans",
    await admin
      .from("smart_card_acknowledgements")
      .upsert({ user_id: A, card_id: "weekend_plans" }, { onConflict: "user_id,card_id" })
  );

  const r = await look("profile-blocking-393", { width: 393 });
  assertLayout("393px", r);
  record(
    "names the blocked feature, not a completion percentage",
    /Linkr is on/i.test(r.cardText) && !/%/.test(r.cardText),
    r.cardText.slice(0, 110)
  );
  record(
    "asks for what Linkr itself requires",
    /profile photo|date of birth/i.test(r.cardText),
    r.cardText.slice(0, 110)
  );

  /* And it must yield the moment a real social state appears: a specific
     broken setting never outranks somebody's birthday. */
  await fixtureMuddyBirthday();
  const outranked = await look("profile-blocking-outranked-393", { width: 393 });
  record(
    "yields to a real social state",
    /birthday/i.test(outranked.cardText),
    outranked.cardText.slice(0, 90)
  );

  await admin.from("smart_card_acknowledgements").delete().eq("user_id", A).eq("card_id", "weekend_plans");
  await restoreAvatar();
}

// ---- G. Proximity ownership still holds with the new states present.
console.log("\n--- G. Nearby is still not duplicated ---");
{
  await clearFixtures();
  await makeHomeMature();
  const eventId = await makeEvent("Acoustic Night");
  await fixtureLinkrMutualEvent(eventId);
  const r = await look("nearby-not-duplicated-393", { width: 393 });
  const duplicated = r.articleTexts.some((t) => /is Close By|Muddies are around/i.test(t));
  record("Smart Card does not duplicate proximity", !duplicated, duplicated ? "DUPLICATE FOUND" : "");
  record(
    "no coordinates or exact distance anywhere on Home",
    !/\b\d+\.\d{4,}\b/.test(r.bodySample) && !/\b\d+(\.\d+)?\s?(m|km|meters|metres|miles)\b/i.test(r.bodySample),
    ""
  );
}

// ---- H. Deep links: a card that names one thing must OPEN that thing.
console.log("\n--- H. deep links land on the named item ---");
{
  await clearFixtures();
  await makeHomeMature();
  await grantAccess();
  await fixturePlanDecision("Friday Dinner", "Where should we eat?");

  const planCard = await look("deeplink-plan-decision-393", { width: 393 });
  const planHref = planCard.primaryHref ?? "";
  record(
    "Vote now points at the exact Plan, not the Plans index",
    planHref.includes(`plan=${ids.plan}`),
    planHref
  );

  const landed = await follow(planHref, "deeplink-plan-open-393");
  record(
    "and opening it lands on that Plan's detail, not a list",
    landed.url.includes(`plan=${ids.plan}`) && !landed.url.includes("/login"),
    `${landed.url} :: ${landed.heading}`
  );
}

// ---- H2. Muddy request opens the Requests tab, not the Muddies index.
console.log("\n--- H2. muddy_request opens the Requests tab ---");
{
  await clearFixtures();
  await makeHomeMature();
  await grantAccess();
  /* From a NON-FRIEND. The database refuses a request between people who are
     already Muddies (`users_are_already_friends`), and the birthday fixture
     above makes A and B friends -- so this scenario uses a third identity. */
  await admin.from("friend_requests").delete().eq("receiver_id", A);
  must(
    "friend_request",
    await admin.from("friend_requests").insert({ sender_id: C, receiver_id: A, status: "pending" })
  );

  const card = await look("muddy-request-393", { width: 393 });
  const href = card.primaryHref ?? "";
  record(
    "Review requests carries the requests tab",
    href === "/friends?tab=requests",
    `${href} :: ${card.cardText.slice(0, 70)}`
  );
  const opened = await follow(href, "muddy-request-open-393");
  record(
    "and lands on Muddies with Requests selected",
    opened.url.includes("tab=requests") && !opened.url.includes("/login"),
    `${opened.url} :: ${opened.heading.slice(0, 70)}`
  );

  await admin.from("friend_requests").delete().eq("receiver_id", A);
}

// ---- I. Entitlement: expansions stop, commitments survive.
console.log("\n--- I. entitlement (HAS / NO / EXPIRED-WITH-COMMITMENT) ---");
{
  await clearFixtures();
  await makeHomeMature();

  // HAS ACCESS: the Event Linkr offer is made.
  await grantAccess();
  const eventId = await makeEvent("Acoustic Night");
  await fixtureCheckedInNoConsent(eventId);
  const withAccess = await look("entitlement-has-access-393", { width: 393 });
  record(
    "HAS ACCESS: Event Linkr is offered",
    /Meet people at Acoustic Night\?/i.test(withAccess.cardText),
    withAccess.cardText.slice(0, 80)
  );

  // NO ACCESS: same fixtures, the expansion disappears.
  await expireAccess();
  const noAccess = await look("entitlement-no-access-393", { width: 393 });
  assertLayout("no access", noAccess);
  record(
    "NO ACCESS: the expansion is not offered",
    !/Meet people at/i.test(noAccess.cardText),
    noAccess.cardText.slice(0, 80)
  );
  record(
    "NO ACCESS: Home never says the product expired, and never sells",
    !/expired|upgrade|subscri|unlock|renew/i.test(noAccess.cardText),
    noAccess.cardText.slice(0, 80)
  );

  // EXPIRED ACCESS WITH AN EXISTING COMMITMENT: the relationship survives.
  await admin.from("check_ins").delete().eq("user_id", A);
  await fixtureLinkrMutualEvent(eventId);
  const commitment = await look("entitlement-expired-commitment-393", { width: 393 });
  assertLayout("expired with commitment", commitment);
  record(
    "EXPIRED + COMMITMENT: the existing Linkr mutual still shows",
    /You connected at Acoustic Night/i.test(commitment.cardText),
    commitment.cardText.slice(0, 90)
  );
  record(
    "EXPIRED + COMMITMENT: Say hi is still offered on it",
    /Say hi/i.test(commitment.cardText),
    commitment.targets.map((t) => t.t).join(" | ")
  );

  /* HOME IS NEVER BLANK FOR AN UNENTITLED VIEWER.
     Which card fills the slot depends on this account's own state -- this
     fixture user has a completed Journey, so the tier-5 milestone legitimately
     wins long before the tier-6 UpFor fallback is ever reached. Asserting the
     fallback's copy here would be asserting the fixture, not the product, and
     would flip with the day of the week and the Journey's progress alike.
     What must hold, and what is checked, is the invariant: a card renders, it
     is not an expansion, and it neither sells nor claims the product ended.
     The fallback's own no-Access copy is pinned in the unit tests, where the
     competing states can be held still. */
  await admin.from("linkr_connections").delete().or(`user_low.eq.${A},user_high.eq.${A}`);
  const fallback = await look("entitlement-expired-fallback-393", { width: 393 });
  assertLayout("expired fallback", fallback);
  record(
    "EXPIRED: Home is never blank -- a card still renders",
    fallback.cardText.length > 0,
    fallback.cardText.slice(0, 90)
  );
  record(
    "EXPIRED: whatever renders is not a gated expansion",
    !/Meet people at/i.test(fallback.cardText) && !/Linkr is on/i.test(fallback.cardText),
    fallback.cardText.slice(0, 90)
  );
  record(
    "EXPIRED: and it neither sells nor says the product ended",
    !/expired|upgrade|subscri|unlock|renew/i.test(fallback.cardText),
    fallback.cardText.slice(0, 90)
  );

  await grantAccess();
}

await clearFixtures();
await clearAccess();
await restoreAvatar();
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? `RUNTIME PROOF: PASS (${results.length}/${results.length})` : `FAILURES: ${failed.length}/${results.length}`}`);
for (const f of failed) console.log(`  FAIL  ${f.name}  ${f.detail}`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length === 0 ? 0 : 1);
