/**
 * RUNTIME PROOF: Home arbitrates ONE card across both candidate spaces.
 *
 * The unit tests prove the ranking. This proves the ranking is what a real
 * browser renders, against `next start` (never `next dev` -- its broken HMR
 * socket blocks hydration and every form silently fails) with a real login.
 *
 * The scenario is the founder's defect, staged for real:
 *   1. A viewer whose Card A state is weak (no location, no Glow).
 *   2. A genuine tier-1 obligation for Card B: an incoming Muddy request.
 * Before the arbiter, Card A rendered and Card B was deferred beneath it.
 * After it, the obligation wins the single slot outright.
 *
 * Then the same viewer WITHOUT the obligation, to prove Card A still renders
 * when it legitimately wins -- the fix must not simply silence Card A.
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

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  — expected ${expected}, saw ${actual}`}`);
}

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const email = `${tag}-${stamp}@local.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
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

/** Which card is on screen: the activation surface, or the Smart Card. */
async function visibleCard(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  /* Selected on the markup the cards already carry, rather than test ids added
     for this script: each Card A variant labels itself with its own headline
     id, and Card B's hero is the only <article> in the stream. */
  const cardA = await page
    .locator('section[aria-labelledby="activation-headline"], section[aria-labelledby="first-muddy-headline"]')
    .count();
  const cardB = await page.locator("main article").first().count();
  return { cardA, cardB };
}

const browser = await chromium.launch();
try {
  const viewer = await person("viewer");
  const asker = await person("asker");

  /* CASE 1: a real tier-1 obligation exists. Somebody is waiting on an answer,
     while Card A has only a weak activation nudge to offer. */
  const { error: reqErr } = await admin.from("friend_requests").insert({
    sender_id: asker.id,
    receiver_id: viewer.id,
    status: "pending"
  });
  if (reqErr) throw new Error(`friend request: ${reqErr.message}`);

  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  await login(page, viewer.email);

  const withObligation = await visibleCard(page);
  await page.screenshot({ path: ".audit/home-arbiter-obligation.png", fullPage: true });
  console.log(`  with obligation  -> cardA=${withObligation.cardA} cardB=${withObligation.cardB}`);
  check("an owed answer wins the single slot", withObligation.cardB > 0, true);
  check("and Card A stands down rather than competing", withObligation.cardA, 0);

  /* CASE 2: the same viewer, obligation resolved. Card A must come back --
     the fix ranks the surfaces, it does not silence one of them. */
  await admin.from("friend_requests").delete().eq("sender_id", asker.id).eq("receiver_id", viewer.id);

  const withoutObligation = await visibleCard(page);
  await page.screenshot({ path: ".audit/home-arbiter-no-obligation.png", fullPage: true });
  console.log(`  no obligation    -> cardA=${withoutObligation.cardA} cardB=${withoutObligation.cardB}`);
  check("Card A returns once nothing outranks it", withoutObligation.cardA > 0, true);

  /* NEVER TWO. The whole point of the single slot. */
  for (const [label, seen] of [["with obligation", withObligation], ["without", withoutObligation]]) {
    check(`exactly one card on screen (${label})`, seen.cardA + seen.cardB <= 1, true);
  }

  await context.close();
} finally {
  await browser.close();
  for (const id of made) {
    await admin.from("friend_requests").delete().or(`sender_id.eq.${id},receiver_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

console.log(failures === 0 ? "\nHome arbitration proof PASSED" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
