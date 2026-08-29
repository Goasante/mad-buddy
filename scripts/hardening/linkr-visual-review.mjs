/**
 * LINKR VISUAL REVIEW.
 *
 * Signs in as the seeded fixture viewer and photographs the real running Linkr
 * experience at several viewports and states, so the review gate is an actual
 * look at the product rather than a test suite passing.
 *
 * Local only. Expects `npm run start` on :3000 and scripts/seed-linkr-fixture.mjs
 * to have been run.
 */

import fs from "node:fs";
import { chromium } from "playwright";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const BASE = process.env.REVIEW_BASE ?? "http://localhost:3000";
const EMAIL = process.env.REVIEW_EMAIL ?? "a@v4test.local";
const PASSWORD = process.env.REVIEW_PASSWORD ?? "LinkrReview123!";
const OUT = process.env.REVIEW_OUT ?? "C:/tmp/linkr-review";

fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  "mobile-narrow": { width: 320, height: 720 },
  mobile: { width: 390, height: 844 },
  "mobile-large": { width: 430, height: 932 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 }
};

/* REFRESH THE FIXTURE'S LOCATION FIRST.
 *
 * Discovery requires a location fresher than PROXIMITY_FRESH_MS (30 minutes) --
 * correct product behaviour: somebody whose position is half an hour old is not
 * "around you" any more. But it means a fixture seeded earlier in a session
 * silently produces an EMPTY DECK, which looks exactly like a broken card and
 * cost a diagnosis once already. Touching last_updated keeps the review looking
 * at the deck rather than at the freshness rule. Nothing else is changed, and
 * this refuses to run against anything but a local database. */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error("REFUSING: not a local Supabase URL:", supabaseUrl);
  process.exit(1);
}
{
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin
    .from("user_locations")
    .update({ last_updated: new Date().toISOString() })
    .not("user_id", "is", null);
  console.log(error ? `location refresh failed: ${error.message}` : "refreshed fixture locations");
}

const browser = await chromium.launch();

/* SIGN IN ONCE, REUSE THE SESSION.
 *
 * auth.login is rate limited -- correct product behaviour, and the right
 * answer to somebody trying passwords in a loop. A harness that logs in afresh
 * for each of five viewports, run a few times while iterating, trips it and
 * then every viewport reports "no card", which reads exactly like a broken
 * page. One login, and the cookies are replayed into each viewport's context.
 * That is also closer to how a real person uses the app. */
const storageStatePath = `${OUT}/session.json`;

async function signInOnce() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  // A decorative logo can intercept the pointer at narrow widths, so the click
  // is forced rather than hit-tested. Same action, no race.
  await page.click('button[type="submit"]', { force: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const signedIn = !new URL(page.url()).pathname.startsWith("/login");
  if (!signedIn) {
    console.error(
      "FAILED to sign in. If this is sudden, check the auth.login rate limit -- " +
        "repeated harness runs can trip it, and it clears on its own."
    );
    process.exit(1);
  }
  await context.storageState({ path: storageStatePath });
  await context.close();
  console.log("signed in once; reusing the session for every viewport");
}

await signInOnce();

async function signedInPage(viewport, { isMobile = true } = {}) {
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: 2,
    storageState: storageStatePath
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return { context, page, errors };
}

async function shoot(page, name) {
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${name}`);
}

/** What the card is actually showing, read out of the live DOM. */
async function readCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".linkr-card");
    if (!card) return { present: false };
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const rect = card.getBoundingClientRect();
    return {
      present: true,
      name: text(".linkr-card__name"),
      intent: text(".linkr-card__intent"),
      proximity: text(".linkr-card__proximity"),
      bio: text(".linkr-card__bio"),
      interests: [...document.querySelectorAll(".linkr-card__interests .linkr-chip")].map((n) =>
        n.textContent.trim()
      ),
      interestRows: new Set(
        [...document.querySelectorAll(".linkr-card__interests .linkr-chip")].map((n) =>
          Math.round(n.getBoundingClientRect().top)
        )
      ).size,
      progressSegments: document.querySelectorAll(".linkr-card__progress-seg").length,
      hasEdgeNav: Boolean(document.querySelector(".linkr-card__edge-nav")),
      actions: [...document.querySelectorAll(".linkr-action")].map((n) => n.textContent.trim()),
      // Share of the viewport the photograph actually occupies.
      cardHeightRatio: Math.round((rect.height / window.innerHeight) * 100),
      // Is the proximity label actually VISIBLE, not merely present? A nowrap
      // flex row with overflow:hidden can clip it to zero width and leave the
      // separator dot dangling with nothing after it.
      proximityWidth: Math.round(
        document.querySelector(".linkr-card__proximity")?.getBoundingClientRect().width ?? -1
      ),
      cardWidth: Math.round(rect.width),
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
}

const report = {};

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  console.log(`\n=== ${label} (${viewport.width}x${viewport.height}) ===`);
  const isMobile = viewport.width < 820;
  const { context, page, errors } = await signedInPage(viewport, { isMobile });
  try {
    await page.goto(`${BASE}/linkr`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Linkr shows a real "Refreshing your Linkr..." state while it loads the
    // deck; waiting for the card rather than a fixed delay avoids
    // photographing that state by accident.
    await page.waitForSelector(".linkr-card", { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shoot(page, `linkr-${label}`);
    const card = await readCard(page);
    report[label] = { card, errors: errors.slice(0, 5) };
    console.log(`  card present: ${card.present}`);
    if (card.present) {
      console.log(`  name=${card.name}  intent=${card.intent}  prox=${card.proximity}`);
      console.log(
        `  interests=[${card.interests.join("|")}] rows=${card.interestRows} segments=${card.progressSegments}`
      );
      console.log(`  card height = ${card.cardHeightRatio}% of viewport, width ${card.cardWidth}px`);
    console.log(`  proximity rendered width = ${card.proximityWidth}px`);
      console.log(
        `  horizontal overflow: ${card.bodyScrollWidth > card.viewportWidth} (${card.bodyScrollWidth} vs ${card.viewportWidth})`
      );
    }
    if (errors.length) console.log(`  CONSOLE ERRORS: ${errors.slice(0, 3).join(" | ")}`);
  } catch (error) {
    console.log(`  FAILED: ${error.message}`);
    report[label] = { error: error.message };
  }
  await context.close();
}

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}/report.json`);
await browser.close();
