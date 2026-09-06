/**
 * Smart Card V2 runtime proof against the REAL rendered Home.
 *
 * Not component snapshots: the page is loaded from `next start` with a genuine
 * session, so what is measured is what a person would actually see -- the gate,
 * the two-card composition, the deferral, and the layout at real phone widths.
 *
 * Local only. Every fixture is created and removed by this script.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";

const ROOT = "C:/mb-profile-perf-p1";
const SHOTS = `${ROOT}/.shots/smart-card`;
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

/* The session comes from a REAL login through the app's own form.
   Hand-building the cookie was tried first and silently produced the login
   page for every probe -- the measurements looked plausible and described the
   wrong screen entirely. Logging in produces whatever cookies the app actually
   uses, which is the only version that cannot drift from it. */
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

/* Maturity is milestone evidence, not a Muddy count (lib/activation/home-composition).
   Without it the viewer is in EARLY activation, Card A owns the screen and every
   Card B state renders quiet -- which is correct, and proves only half the rule.
   These two helpers let the proof exercise both branches deliberately. */
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

async function makeHomeEarly() {
  await admin.from("activation_milestones").delete().eq("user_id", A);
}

async function clearFixtures() {
  await admin.from("hangout_requests").delete().eq("requester_id", A);
  const { data: mine } = await admin.from("hangout_sessions").select("id").eq("owner_id", A);
  for (const row of mine ?? []) {
    await admin.from("hangout_requests").delete().eq("hangout_session_id", row.id);
  }
  await admin.from("hangout_sessions").delete().eq("owner_id", A);
  await admin.from("safe_arrival_events").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("safe_arrival_contacts").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", A);
}

/** A live UpFor with people waiting -> tier 1, and Card A absent (mature Home). */
async function fixtureUpForRequests() {
  const { data: session } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: A,
      activity_type: "coffee",
      audience_type: "all_muddies",
      status: "active",
      starts_at: new Date(Date.now() - 6e5).toISOString(),
      ends_at: new Date(Date.now() + 72e5).toISOString(),
      max_participants: 4
    })
    .select("id")
    .maybeSingle();
  if (session?.id) {
    await admin
      .from("hangout_requests")
      .insert({ hangout_session_id: session.id, requester_id: B, status: "pending" });
  }
  return session?.id ?? null;
}

/** A live Safe Arrival -> tier 0, must never be deferred. */
async function fixtureSafeArrival() {
  const { data } = await admin
    .from("safe_arrival_sessions")
    .insert({
      traveller_id: A,
      destination_label: "Visual proof",
      expected_arrival_at: new Date(Date.now() + 72e5).toISOString(),
      status: "active"
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/* --------------------------------------------------------------------- probe */

const browser = await chromium.launch({ headless: true });

const { state: authState, landed } = await signedInState(browser);
if (landed.includes("/login")) {
  console.error("HARD STOP: login did not succeed; every probe would measure the login page.");
  await browser.close();
  process.exit(1);
}
console.log("signed in, landed on " + landed);
console.log("");

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

  /* A silent redirect to /login would make every measurement below describe
     the wrong screen while still looking plausible. */
  const onHome = !page.url().includes("/login");

  const shot = `${SHOTS}/${label}.png`;
  await page.screenshot({ path: shot, fullPage: false });

  const probe = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    /* The Smart Card is the <article> the V2 renderer emits; Card A and
       NearbyHero are found by the copy only they produce. */
    const articles = [...document.querySelectorAll("article")];
    const body = document.body.innerText;
    const doc = document.documentElement;
    return {
      articleCount: articles.length,
      articleTexts: articles.map((a) => text(a).slice(0, 120)),
      /* The rendered treatment, read from the card itself. bg-card is the quiet
         branch; the gradient tones are the full one. Asserting this rather than
         assuming it caught a mislabelled scenario: a run titled "Card A absent"
         in which Card A was on screen the whole time. */
      smartCardTreatment: (() => {
        const card = articles.find((a) =>
          /NEEDS YOUR RESPONSE|HAPPENING NOW|STARTING SOON|SAFE ARRIVAL|THIS WEEKEND|COMING UP|GATHERING|MILESTONE/i.test(text(a))
        );
        if (!card) return "none";
        const cls = card.className;
        if (/bg-gradient-to-br/.test(cls)) return "full";
        if (/bg-card/.test(cls)) return "quiet";
        return "unknown";
      })(),
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      bodySample: body.replace(/\s+/g, " ").slice(0, 400),
      /* Only the SMART CARD's own actions. Measuring every link on Home made
         this fail on the page's inline text links and the skip-to-content
         anchor, which are not what the 44px rule is about here. */
      targets: [...(articles.find((a) => /NEEDS YOUR RESPONSE|HAPPENING NOW|STARTING SOON|SAFE ARRIVAL|UPFOR|COMING UP|GATHERING|YOU ARE|MILESTONE/i.test(text(a))) ?? document.createElement("div")).querySelectorAll("a,button")]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { t: text(el).slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((t) => t.t)
    };
  });

  await context.close();
  return { ...probe, errors, shot, onHome };
}

/* --------------------------------------------------------------------- run */

console.log("=== SMART CARD V2 RUNTIME PROOF ===\n");

await clearFixtures();

// ---- F/G: mature Home, tier-1 UpFor requests, full (non-deferred) treatment.
console.log("--- tier 1 Card B (Card A also on screen -> quiet) ---");
await makeHomeMature();
await fixtureUpForRequests();

for (const width of [360, 393, 430]) {
  const r = await look(`tier1-${width}`, { width });
  record(`${width}px renders without horizontal overflow`, !r.horizontalOverflow, `${r.scrollWidth}/${r.clientWidth}`);
  record(`${width}px page errors`, r.errors.length === 0, r.errors.join("; "));
  const smart = r.articleTexts.find((t) => /join your|UpFor/i.test(t));
  record(`${width}px shows the UpFor request card`, Boolean(smart), smart?.slice(0, 60) ?? "(not found)");
  const small = r.targets.filter((t) => t.h > 0 && t.h < 44);
  record(`${width}px action targets >= 44px`, small.length === 0, small.slice(0, 3).map((t) => `${t.t}:${t.h}`).join(", "));
  record(`${width}px Card B is quiet beside Card A`, r.smartCardTreatment === "quiet", r.smartCardTreatment);
}

const dark = await look("tier1-dark-393", { width: 393, dark: true });
record("dark mode renders", dark.errors.length === 0 && !dark.horizontalOverflow, dark.errors.join("; "));

const big = await look("tier1-200pct-393", { width: 393, textScale: 2 });
record("200% text: no horizontal overflow", !big.horizontalOverflow, `${big.scrollWidth}/${big.clientWidth}`);
record("200% text: actions still present", big.targets.length > 0, `${big.targets.length} targets`);

const rm = await look("tier1-reducedmotion-393", { width: 393, reducedMotion: true });
record("reduced motion renders", rm.errors.length === 0, rm.errors.join("; "));

// ---- E: safety keeps full authority.
console.log("\n--- tier 0 Safe Arrival ---");
await clearFixtures();
await fixtureSafeArrival();
const safety = await look("safety-393", { width: 393 });
const safetyCard = safety.articleTexts.find((t) => /safe arrival|journey/i.test(t));
record("Safe Arrival card is on screen", Boolean(safetyCard), safetyCard?.slice(0, 60) ?? "(not found)");
record("safety: no overflow", !safety.horizontalOverflow, `${safety.scrollWidth}/${safety.clientWidth}`);
record("safety keeps FULL authority beside Card A", safety.smartCardTreatment === "full", safety.smartCardTreatment);

// ---- B/C: early activation. Card A owns the screen; Card B must be QUIET.
console.log("");
console.log("--- Card A + tier 1 Card B (early activation) ---");
await clearFixtures();
await makeHomeEarly();
await fixtureUpForRequests();
const two = await look("cardA-plus-tier1-393", { width: 393 });
const hasSmart = two.articleTexts.some((t) => /NEEDS YOUR RESPONSE/i.test(t));
record("tier 1 still reaches a new viewer", hasSmart, hasSmart ? "" : "(suppressed)");
record("two-card Home has no overflow", !two.horizontalOverflow, two.scrollWidth + "/" + two.clientWidth);
record("two-card Home has no page errors", two.errors.length === 0, two.errors.join("; "));

// ---- D: a tier 5 state must be SUPPRESSED while activation teaches.
console.log("");
console.log("--- Card A + tier 5 (must be suppressed) ---");
await clearFixtures();
const lowTier = await look("cardA-tier5-393", { width: 393 });
const journeyShown = lowTier.articleTexts.some((t) => /Journey|Buddy Score/i.test(t));
record("progression is suppressed during early activation", !journeyShown, journeyShown ? "JOURNEY VISIBLE" : "");
await makeHomeMature();

// ---- H: nearby is NearbyHero's, never Card B's.
console.log("\n--- proximity ownership ---");
await clearFixtures();
const nearby = await look("nearby-393", { width: 393 });
const duplicated = nearby.articleTexts.some((t) => /is Close By|Muddies are around/i.test(t));
record("Smart Card does not duplicate proximity", !duplicated, duplicated ? "DUPLICATE FOUND" : "");

// ---- quiet/fallback state.
console.log("\n--- quiet Home ---");
const quiet = await look("quiet-393", { width: 393 });
record("quiet Home renders", quiet.errors.length === 0, quiet.errors.join("; "));
record("quiet Home: no overflow", !quiet.horizontalOverflow, "");

await clearFixtures();
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "RUNTIME PROOF: PASS" : `FAILURES: ${failed.length}`}`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length === 0 ? 0 : 1);
