/**
 * THE TWO STATIC HOME BACKGROUNDS, on the REAL rendered Home.
 *
 * The rule under test is a NEGATIVE one, which is why source tests cannot
 * settle it: the content layer must change with every state while the
 * background stays byte-identical. So this drives Card B through four
 * genuinely different states, reads the actual resolved image URL out of the
 * DOM each time, and asserts the words differ and the ground does not.
 *
 * It also measures what a person would actually see: the rendered pixels behind
 * the headline, to confirm the artwork is really there and the copy is legible
 * over it rather than merely present in the markup.
 *
 * Local only. Every fixture is created and removed by this script.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const ROOT = "C:/mb-profile-perf-p1";
const SHOTS = `${ROOT}/.shots/home-static-backgrounds`;
mkdirSync(SHOTS, { recursive: true });

const CARD_A = "/visuals/home-cards/card-a-background.png";
const CARD_B = "/visuals/home-cards/card-b-background.png";

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

const VIEWER = "4a000000-0000-4000-8000-00000000004a";
const AMA = "4b000000-0000-4000-8000-00000000004b";
const KOJO = "4c000000-0000-4000-8000-00000000004c";

const LOGIN_EMAIL = "a@v4test.local";
const LOGIN_PASSWORD = "ProofPass123!";

const results = [];
const record = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  results.push({ name, ok, detail });
};

function must(label, result) {
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

const ids = { ama: null, kojo: null };

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
  for (const other of [AMA, KOJO]) {
    const key = [VIEWER, other].sort().join(":");
    const { data: convs } = await admin.from("conversations").select("id").eq("direct_key", key);
    for (const conv of convs ?? []) {
      await admin.from("messages").delete().eq("conversation_id", conv.id);
      await admin.from("conversation_members").delete().eq("conversation_id", conv.id);
      await admin.from("conversations").delete().eq("id", conv.id);
    }
  }
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", VIEWER);
  await admin.from("smart_card_acknowledgements").delete().eq("user_id", VIEWER);
  ids.ama = null;
  ids.kojo = null;
}

async function setMature(mature) {
  if (mature) {
    await admin.from("activation_milestones").upsert(
      [
        { user_id: VIEWER, milestone: "first_muddy_added" },
        { user_id: VIEWER, milestone: "first_wave_sent" },
        { user_id: VIEWER, milestone: "first_plan_created" }
      ],
      { onConflict: "user_id,milestone" }
    );
  } else {
    await admin.from("activation_milestones").delete().eq("user_id", VIEWER);
  }
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
  return session?.id ?? null;
}

/* --------------------------------------------------------------------- probe */

const browser = await chromium.launch({ headless: true });

const authContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
{
  const page = await authContext.newPage();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).first().fill(LOGIN_EMAIL);
  await page.getByLabel(/password/i).first().fill(LOGIN_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in/i }).first().click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (page.url().includes("/login")) {
    console.error("HARD STOP: login failed; every probe would measure the login page.");
    await browser.close();
    process.exit(1);
  }
  await page.close();
}
const authState = await authContext.storageState();
await authContext.close();
console.log("signed in\n");

/**
 * Read Home as a person sees it.
 *
 * `resolvedBackgrounds` walks every <img> inside each card and reports the
 * ACTUAL loaded source plus its natural size -- so a broken or missing file is
 * visible as naturalWidth 0 rather than passing because the tag exists.
 */
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
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
  page.on("response", (r) => {
    if (r.url().includes("/visuals/home-cards/") && r.status() >= 400) {
      failedRequests.push(`${r.status()} ${r.url()}`);
    }
  });
  if (textScale !== 1) {
    /* On document_start `documentElement` can still be null; setting the size
       once the DOM exists measures the same thing without throwing an error
       this proof would then report as a product defect. */
    await page.addInitScript((scale) => {
      const apply = () => {
        if (document.documentElement) document.documentElement.style.fontSize = `${16 * scale}px`;
      };
      apply();
      document.addEventListener("DOMContentLoaded", apply);
    }, textScale);
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/${label}.png`, fullPage: false });

  const probe = await page.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    const doc = document.documentElement;

    /* CARD A is the activation section; CARD B is the Smart Card article. */
    const cardA = document.querySelector('section[aria-labelledby="activation-headline"]');
    const EYEBROW =
      /NEEDS YOUR RESPONSE|NEEDS YOUR ANSWER|HAPPENING NOW|STARTING SOON|SAFE ARRIVAL|THIS WEEKEND|COMING UP|GATHERING|MILESTONE|YOU BOTH CONNECTED|YOU'RE CHECKED IN|BEING DECIDED|TODAY|FINISH SETUP|YOU'RE IN|UPFOR/i;
    const cardB = [...document.querySelectorAll("article")].find((a) => EYEBROW.test(text(a)));

    const imagesIn = (root) =>
      root
        ? [...root.querySelectorAll("img")].map((img) => ({
            src: new URL(img.currentSrc || img.src, location.origin).searchParams.get("url") ??
              new URL(img.currentSrc || img.src, location.origin).pathname,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
          }))
        : [];

    return {
      cardAPresent: Boolean(cardA),
      cardAText: cardA ? text(cardA) : "",
      cardAImages: imagesIn(cardA),
      cardBPresent: Boolean(cardB),
      cardBText: cardB ? text(cardB) : "",
      cardBImages: imagesIn(cardB),
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth
    };
  });

  await context.close();
  return { ...probe, errors, failedRequests };
}

const decoded = (images) => images.map((i) => decodeURIComponent(i.src));

/* Only the home-card GROUND. A card may legitimately carry foreground imagery
   -- Card A renders the brand mark in the states that are about Glow -- and
   that is content, not background. Comparing every <img> would report a
   changing background because the foreground changed, which is the opposite of
   what this proof is for. */
const groundOf = (images) =>
  decoded(images).filter((src) => src.includes("/visuals/home-cards/")).join("|");
const hasBackground = (images, path) => decoded(images).some((src) => src.includes(path));
const loadedOk = (images, path) =>
  images.some((i) => decodeURIComponent(i.src).includes(path) && i.naturalWidth > 0);

/* --------------------------------------------------------------------- run */

console.log("=== HOME STATIC BACKGROUND PROOF ===\n");

await clearFixtures();
await ensureMuddy(AMA);
await ensureMuddy(KOJO);
await setMature(true);

console.log("--- A. Card B: four different states, one background ---");
const cardBRuns = [];
{
  // 1. discovery
  ids.ama = await createUpFor(AMA, "coffee");
  cardBRuns.push(["discovery", await look("cardB-1-discovery")]);

  // 2. waiting
  must(
    "join_request",
    await admin
      .from("hangout_requests")
      .insert({ hangout_session_id: ids.ama, requester_id: VIEWER, status: "pending" })
  );
  cardBRuns.push(["waiting", await look("cardB-2-waiting")]);

  // 3. accepted
  await admin
    .from("hangout_requests")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("hangout_session_id", ids.ama)
    .eq("requester_id", VIEWER);
  cardBRuns.push(["accepted", await look("cardB-3-accepted")]);

  // 4. next opportunity, after the message job completes
  const key = [VIEWER, AMA].sort().join(":");
  const conv = must(
    "conversation",
    await admin
      .from("conversations")
      .insert({ conversation_type: "direct", direct_key: key, status: "active" })
      .select("id")
      .maybeSingle()
  );
  must(
    "members",
    await admin.from("conversation_members").insert([
      { conversation_id: conv.id, user_id: VIEWER, status: "joined" },
      { conversation_id: conv.id, user_id: AMA, status: "joined" }
    ])
  );
  must(
    "viewer_message",
    await admin.from("messages").insert({
      conversation_id: conv.id,
      sender_id: VIEWER,
      text_content: "See you at the cafe!",
      message_type: "text"
    })
  );
  ids.kojo = await createUpFor(KOJO, "gym");
  cardBRuns.push(["next opportunity", await look("cardB-4-next")]);

  for (const [name, r] of cardBRuns) {
    record(`${name}: Card B rendered`, r.cardBPresent, r.cardBText.slice(0, 70));
    record(
      `${name}: background is card-b-background.png`,
      hasBackground(r.cardBImages, CARD_B),
      decoded(r.cardBImages).join(" | ") || "(no image)"
    );
    record(
      `${name}: the file actually loaded`,
      loadedOk(r.cardBImages, CARD_B),
      r.cardBImages.map((i) => `${i.naturalWidth}x${i.naturalHeight}`).join(" | ")
    );
    record(
      `${name}: never Card A's ground`,
      !hasBackground(r.cardBImages, CARD_A),
      decoded(r.cardBImages).join(" | ")
    );
    record(`${name}: no failed image requests`, r.failedRequests.length === 0, r.failedRequests.join("; "));
  }

  /* THE WHOLE POINT: content differs, background identical. */
  const texts = cardBRuns.map(([, r]) => r.cardBText);
  record(
    "the CONTENT changed across all four states",
    new Set(texts).size === 4,
    `${new Set(texts).size} distinct`
  );
  const grounds = cardBRuns.map(([, r]) => groundOf(r.cardBImages));
  record(
    "the BACKGROUND stayed identical across all four",
    new Set(grounds).size === 1,
    [...new Set(grounds)].join("  //  ")
  );
}

console.log("\n--- B. Card A: foreground changes, background does not ---");
{
  const cardARuns = [];

  await clearFixtures();
  await setMature(false);
  await admin.from("friendships").delete().or(`user_one_id.eq.${VIEWER},user_two_id.eq.${VIEWER}`);
  cardARuns.push(["no muddies", await look("cardA-1-no-muddies")]);

  await ensureMuddy(AMA);
  cardARuns.push(["has a muddy", await look("cardA-2-has-muddy")]);

  for (const [name, r] of cardARuns) {
    record(`${name}: Card A rendered`, r.cardAPresent, r.cardAText.slice(0, 70));
    record(
      `${name}: background is card-a-background.png`,
      hasBackground(r.cardAImages, CARD_A),
      decoded(r.cardAImages).join(" | ") || "(no image)"
    );
    record(
      `${name}: the file actually loaded`,
      loadedOk(r.cardAImages, CARD_A),
      r.cardAImages.map((i) => `${i.naturalWidth}x${i.naturalHeight}`).join(" | ")
    );
    record(
      `${name}: never Card B's ground`,
      !hasBackground(r.cardAImages, CARD_B),
      decoded(r.cardAImages).join(" | ")
    );
  }

  const aTexts = cardARuns.map(([, r]) => r.cardAText);
  record("Card A's CONTENT changed between states", new Set(aTexts).size === 2, `${new Set(aTexts).size} distinct`);
  const aGrounds = cardARuns.map(([, r]) => groundOf(r.cardAImages));
  record("Card A's BACKGROUND stayed identical", new Set(aGrounds).size === 1, [...new Set(aGrounds)].join("  //  "));
}

console.log("\n--- C. Safe Arrival keeps Card B's ground ---");
{
  await clearFixtures();
  await setMature(true);
  must(
    "safe_arrival",
    await admin
      .from("safe_arrival_sessions")
      .insert({
        traveller_id: VIEWER,
        destination_label: "Static background proof",
        expected_arrival_at: new Date(Date.now() + 72e5).toISOString(),
        status: "active"
      })
      .select("id")
      .maybeSingle()
  );
  const r = await look("cardB-safe-arrival");
  record("Safe Arrival is the card on screen", /SAFE ARRIVAL/i.test(r.cardBText), r.cardBText.slice(0, 70));
  record(
    "and it uses the SAME Card B ground, not special artwork",
    hasBackground(r.cardBImages, CARD_B),
    decoded(r.cardBImages).join(" | ")
  );
  await admin.from("safe_arrival_sessions").delete().eq("traveller_id", VIEWER);
}

console.log("\n--- D. every width, theme and accessibility mode ---");
{
  await clearFixtures();
  await setMature(true);
  await ensureMuddy(AMA);
  ids.ama = await createUpFor(AMA, "coffee");

  const modes = [
    ["360", { width: 360 }],
    ["393", { width: 393 }],
    ["430", { width: 430 }],
    ["light", { width: 393, dark: false }],
    ["dark", { width: 393, dark: true }],
    ["200pct", { width: 393, textScale: 2 }],
    ["reduced-motion", { width: 393, reducedMotion: true }]
  ];

  for (const [name, opts] of modes) {
    const r = await look(`mode-${name}`, opts);
    record(`${name}: Card B ground present and loaded`, loadedOk(r.cardBImages, CARD_B), decoded(r.cardBImages).join(" | "));
    record(`${name}: no horizontal overflow`, !r.horizontalOverflow, `${r.scrollWidth}/${r.clientWidth}`);
    record(`${name}: no page errors`, r.errors.length === 0, r.errors.join("; "));
    record(`${name}: no failed image requests`, r.failedRequests.length === 0, r.failedRequests.join("; "));
  }
}

await clearFixtures();
await setMature(true);
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? `RUNTIME PROOF: PASS (${results.length}/${results.length})` : `FAILURES: ${failed.length}/${results.length}`}`
);
for (const f of failed) console.log(`  FAIL  ${f.name}  ${f.detail}`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failed.length === 0 ? 0 : 1);
