/**
 * MUDDIES VISUAL REVIEW.
 *
 * Photographs the real running Muddies surface at the viewports the brief
 * names, and reads the live DOM for the things a screenshot cannot assert:
 * horizontal overflow, touch-target sizes, row counts, and whether anything
 * that looks like a distance has leaked into the page text.
 *
 * Local only. Expects `npm run start` and scripts/seed-muddies-fixture.mjs.
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
const OUT = process.env.REVIEW_OUT ?? "C:/tmp/muddies-review";
const LABEL = process.env.REVIEW_LABEL ?? "state";

fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  "mobile-narrow": { width: 320, height: 720 },
  mobile: { width: 390, height: 844 },
  "mobile-large": { width: 430, height: 932 },
  desktop: { width: 1440, height: 900 }
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error("REFUSING: not a local Supabase URL:", supabaseUrl);
  process.exit(1);
}

/* Proximity is time-sensitive: a fix older than PROXIMITY_FRESH_MS stops
   counting as "around you", which empties the rail and looks like a bug. */
{
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await admin
    .from("user_locations")
    .update({ last_updated: new Date().toISOString() })
    .not("user_id", "is", null);
  // auth.login is rate limited; a per-viewport login trips it.
  await admin.from("rate_limits").delete().eq("action", "auth.login");
  console.log("refreshed fixture locations");
}

const browser = await chromium.launch();
const storageStatePath = `${OUT}/session.json`;

async function signInOnce() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]', { force: true });
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  if (new URL(page.url()).pathname.startsWith("/login")) {
    console.error("FAILED to sign in (check the auth.login rate limit).");
    process.exit(1);
  }
  await context.storageState({ path: storageStatePath });
  await context.close();
  console.log("signed in once; reusing the session");
}

await signInOnce();

/** What the page is actually showing. */
async function readPage(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const rows = [...document.querySelectorAll("[data-muddy-id], .muddies-grid > *, .muddy-row")];
    const tapTargets = [...document.querySelectorAll("button, a[href]")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    return {
      rowCount: rows.length,
      // Anything that reads like an exact distance is a privacy failure.
      leaksDistance: /\b\d+\s?(m|km|metres|meters|miles|mi)\b/i.test(text),
      leaksCoordinates: /-?\d{1,3}\.\d{4,}/.test(text),
      headings: [...document.querySelectorAll("h1, h2")].map((h) => h.textContent.trim()).slice(0, 8),
      hasSearch: Boolean(document.querySelector('input[type="search"], input[placeholder*="earch" i]')),
      smallTargets: tapTargets.filter((r) => r.height < 40 || r.width < 40).length,
      totalTargets: tapTargets.length,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      snippet: text.slice(0, 220).replace(/\n+/g, " | ")
    };
  });
}

const report = {};
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  console.log(`\n=== ${LABEL} / ${name} (${viewport.width}x${viewport.height}) ===`);
  const isMobile = viewport.width < 820;
  const context = await browser.newContext({
    viewport,
    isMobile,
    hasTouch: isMobile,
    deviceScaleFactor: 2,
    storageState: storageStatePath
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3200);
    await page.screenshot({ path: `${OUT}/${LABEL}-${name}.png`, fullPage: false });
    const info = await readPage(page);
    report[`${LABEL}-${name}`] = { ...info, errors: errors.slice(0, 3) };
    console.log(`  rows=${info.rowCount} search=${info.hasSearch}`);
    console.log(`  headings: ${info.headings.join(" / ")}`);
    console.log(
      `  overflow=${info.bodyScrollWidth > info.viewportWidth} (${info.bodyScrollWidth} vs ${info.viewportWidth})`
    );
    console.log(`  distance leak=${info.leaksDistance} coords leak=${info.leaksCoordinates}`);
    console.log(`  touch targets under 40px: ${info.smallTargets}/${info.totalTargets}`);
    console.log(`  ${info.snippet}`);
    if (errors.length) console.log(`  PAGE ERRORS: ${errors.slice(0, 2).join(" | ")}`);
  } catch (error) {
    console.log(`  FAILED: ${error.message}`);
    report[`${LABEL}-${name}`] = { error: error.message };
  }
  await context.close();
}

fs.writeFileSync(`${OUT}/report-${LABEL}.json`, JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}/report-${LABEL}.json`);
await browser.close();
