/**
 * RUNTIME PRIORITY PROOF for Home's one-card arbiter.
 *
 * The unit tests prove the ranking as a function. This proves the RENDERED
 * Home obeys it, against `next start` (never `next dev` -- its broken HMR
 * socket blocks hydration) with a real login and real seeded database rows.
 *
 * Every scenario stages a genuine COLLISION: a Card A activation candidate is
 * always present (the viewer has no Muddies / no location), so if the arbiter
 * were not doing its job Card A would win by default the way it used to.
 *
 *   A  safety (tier 0)            beats activation and a lower opportunity
 *   B  live coordination (tier 2) beats activation
 *   C  opportunity/progression    wins when nothing above it applies
 *   D  determinism                the same seeded state renders the same card
 *
 * Each of A-C then RESOLVES its winner and re-checks, proving the next correct
 * candidate advances rather than Home going blank or getting stuck.
 *
 * The card on screen is identified by its rendered eyebrow/title text, not by
 * a test id, so this measures what a person actually sees.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3210";
const SUPABASE_URL = "http://127.0.0.1:54321";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const PASSWORD = "ArbiterProof123!";
const made = [];
let failures = 0;

function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true
  });
  if (error) throw new Error(`${tag} account: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id,
    username: `${tag.replace(/[^a-z0-9]/gi, "")}${stamp.slice(-6)}`,
    full_name: `${tag[0].toUpperCase()}${tag.slice(1)} Tester`,
    is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return { id, email };
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
}

/**
 * What Home actually renders in its single adaptive slot.
 *
 * Counts BOTH authorities independently, so "one card" is measured rather
 * than assumed, and reads the winner's own text to name it.
 */
async function readHome(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1000);

  const cardA = page.locator(
    'section[aria-labelledby="activation-headline"], section[aria-labelledby="first-muddy-headline"]'
  );
  const cardB = page.locator("main article").first();

  const cardACount = await cardA.count();
  const cardBCount = await cardB.count();

  let winner = "none";
  let text = "";
  if (cardBCount > 0) {
    winner = "card_b";
    text = (await cardB.innerText()).replace(/\s+/g, " ").trim().slice(0, 90);
  } else if (cardACount > 0) {
    winner = "card_a";
    text = (await cardA.first().innerText()).replace(/\s+/g, " ").trim().slice(0, 90);
  }
  return { winner, text, adaptiveCards: cardACount + cardBCount };
}

/** A live Safe Arrival journey: the tier-0 override. */
async function seedSafeArrival(userId) {
  const { data, error } = await admin
    .from("safe_arrival_sessions")
    .insert({
      traveller_id: userId,
      destination_type: "custom",
      destination_label: "Home from the airport",
      expected_arrival_at: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      grace_period_minutes: 15,
      status: "active",
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();
  if (error) throw new Error(`safe arrival: ${error.message}`);
  return data.id;
}

/**
 * A confirmed Plan starting within the hour, with the viewer going: tier 2.
 * Built through the CANONICAL lifecycle RPC rather than raw inserts, so an
 * invalid enum cannot silently create nothing and fake a passing result.
 */
async function seedPlanStarting(hostId, viewerId) {
  const startAt = new Date(Date.now() + 40 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: hostId,
    p_request_key: crypto.randomUUID(),
    p_title: "Coffee before the match",
    p_description: null,
    p_plan_type: "scheduled",
    p_start_at: startAt,
    p_end_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    p_timezone: "UTC",
    p_rsvp_deadline: null,
    p_place_type: "custom",
    p_custom_place_text: "The usual place",
    p_reminder_minutes: null,
    p_category: "coffee",
    p_invitee_ids: [viewerId],
    p_initial_going_ids: [viewerId],
    p_source_hangout_id: null,
    p_effective_max_active_plans: 50,
    p_effective_max_participants: 20
  });
  if (error) throw new Error(`plan lifecycle: ${error.message}`);
  const planId = data?.[0]?.plan_id;
  if (!planId) throw new Error("plan lifecycle returned no plan id");
  /* Going, and confirmed: plan_starting deliberately ignores an unanswered
     invitation (that is tier 1's job, a different card). */
  await admin.from("plan_participants").update({ rsvp_status: "going" })
    .eq("plan_id", planId).eq("user_id", viewerId);
  await admin.from("plans").update({ status: "confirmed" }).eq("id", planId);
  return planId;
}

const browser = await chromium.launch();
const results = {};
try {
  const viewer = await person("viewer");
  const host = await person("host");
  /* The Card A candidate is present throughout: this viewer has no Muddies and
     no location, so activation always has something to say. Every win below is
     therefore a real collision, not an empty field. */
  await admin.from("friendships").insert({
    user_one_id: [viewer.id, host.id].sort()[0],
    user_two_id: [viewer.id, host.id].sort()[1]
  });

  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await login(page, viewer.email);

  // ---------------------------------------------------------------- SCENARIO A
  console.log("\nSCENARIO A — safety outranks everything");
  const sessionId = await seedSafeArrival(viewer.id);
  const planForA = await seedPlanStarting(host.id, viewer.id); // a tier-2 rival too
  const a = await readHome(page);
  console.log(`  winner=${a.winner} cards=${a.adaptiveCards} :: ${a.text}`);
  await page.screenshot({ path: ".audit/arbiter-a-safety.png", fullPage: true });
  check("safety wins the single slot", /SAFE ARRIVAL|journey/i.test(a.text), a.text);
  check("exactly one adaptive card", a.adaptiveCards === 1, `saw ${a.adaptiveCards}`);
  results.safety = a;

  // Resolve the safety condition; the tier-2 Plan must advance.
  await admin.from("safe_arrival_sessions")
    .update({ status: "completed", confirmed_at: new Date().toISOString() })
    .eq("id", sessionId);
  const aNext = await readHome(page);
  console.log(`  after resolve -> winner=${aNext.winner} cards=${aNext.adaptiveCards} :: ${aNext.text}`);
  check("the next candidate advances once safety clears",
    /STARTING SOON|Coffee before the match/i.test(aNext.text), aNext.text);
  check("still exactly one adaptive card", aNext.adaptiveCards === 1, `saw ${aNext.adaptiveCards}`);
  results.safetyAdvance = aNext;

  // ---------------------------------------------------------------- SCENARIO B
  console.log("\nSCENARIO B — live coordination outranks activation");
  const b = aNext; // the Plan is live and activation is still a candidate
  await page.screenshot({ path: ".audit/arbiter-b-coordination.png", fullPage: true });
  check("live coordination beats the activation card",
    b.winner === "card_b" && /STARTING SOON/i.test(b.text), b.text);
  results.coordination = b;

  // Resolve the Plan; something lower must advance.
  await admin.from("plans").update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", planForA);
  const bNext = await readHome(page);
  console.log(`  after resolve -> winner=${bNext.winner} cards=${bNext.adaptiveCards} :: ${bNext.text}`);
  check("a lower candidate advances once coordination clears",
    bNext.winner !== "none", bNext.text);
  check("still exactly one adaptive card", bNext.adaptiveCards === 1, `saw ${bNext.adaptiveCards}`);
  results.coordinationAdvance = bNext;

  // ---------------------------------------------------------------- SCENARIO C
  console.log("\nSCENARIO C — opportunity / progression with no obligation above it");
  const c = bNext;
  await page.screenshot({ path: ".audit/arbiter-c-opportunity.png", fullPage: true });
  check("with no tier 0/1/2 obligation, a lower candidate holds the slot",
    c.winner !== "none" && c.adaptiveCards === 1, `${c.winner} / ${c.adaptiveCards}`);
  results.opportunity = c;

  /* C2: silence Card A entirely, so a CARD B tier-5 candidate has to hold the
     slot on its own. Without this, scenario C only proves activation advances
     -- it never shows a low-tier Smart Card winning, which is the other half
     of "one card must not mean half the intelligence disappeared". */
  console.log("\nSCENARIO C2 — a Card B progression state wins once Card A is silent");
  await admin.from("user_locations").upsert({
    user_id: viewer.id, latitude: 5.6, longitude: -0.19,
    accuracy: 12, confidence: "high", last_updated: new Date().toISOString()
  }, { onConflict: "user_id" });
  await admin.from("profiles").update({ visibility_status: "visible" }).eq("user_id", viewer.id);
  /* The last step to `activated`: with a Muddy, a fresh fix, Glow on and a Plan
     behind them, Card A has nothing left to teach and renders nothing at all.
     Only then is the slot genuinely uncontested by Card A. */
  await admin.from("activation_milestones")
    .upsert({ user_id: viewer.id, milestone: "first_plan_created" }, { onConflict: "user_id,milestone" });
  const c2 = await readHome(page);
  console.log(`  winner=${c2.winner} cards=${c2.adaptiveCards} :: ${c2.text}`);
  await page.screenshot({ path: ".audit/arbiter-c2-progression.png", fullPage: true });
  check("a Card B progression/fallback state holds the slot alone",
    c2.winner === "card_b", `${c2.winner} :: ${c2.text}`);
  check("exactly one adaptive card", c2.adaptiveCards === 1, `saw ${c2.adaptiveCards}`);
  results.progression = c2;

  // ---------------------------------------------------------------- SCENARIO D
  console.log("\nSCENARIO D — determinism");
  const reloads = [];
  for (let i = 0; i < 5; i += 1) reloads.push(await readHome(page));
  const winners = new Set(reloads.map((r) => `${r.winner}::${r.text}`));
  const counts = new Set(reloads.map((r) => r.adaptiveCards));
  console.log(`  ${reloads.length} reloads -> ${winners.size} distinct winner(s)`);
  check("the same seeded state renders the same card every reload", winners.size === 1,
    [...winners].join(" | ").slice(0, 120));
  check("and never more than one adaptive card", [...counts].every((n) => n <= 1),
    `counts ${[...counts].join(",")}`);
  results.determinism = { distinct: winners.size, counts: [...counts] };

  const maxCards = Math.max(
    ...[a, aNext, b, bNext, c, c2, ...reloads].map((r) => r.adaptiveCards)
  );
  console.log(`\nMAX ADAPTIVE CARDS RENDERED = ${maxCards}`);
  check("Home never rendered two adaptive cards at once", maxCards <= 1, `max ${maxCards}`);
  results.maxCards = maxCards;

  await context.close();
} finally {
  await browser.close();
  for (const id of made) {
    await admin.from("safe_arrival_sessions").delete().eq("traveller_id", id);
    await admin.from("plan_participants").delete().eq("user_id", id);
    await admin.from("plans").delete().eq("creator_id", id);
    await admin.from("friend_requests").delete().or(`sender_id.eq.${id},receiver_id.eq.${id}`);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

console.log(failures === 0 ? "\nPRIORITY PROOF PASSED" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
