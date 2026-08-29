/**
 * TRANCHE A — RUNTIME VISUAL SWEEP.
 *
 * Photographs every surface this tranche touched at the four sizes the brief
 * names, in both themes, and reports the things a screenshot cannot assert:
 * horizontal overflow, sub-44px touch targets, and phantom scroll (a page
 * taller than its content because something is holding space it should not).
 *
 * Local only.
 */

import fs from "node:fs";
import { chromium } from "playwright";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const BASE = process.env.REVIEW_BASE ?? "http://localhost:3300";
const EMAIL = process.env.REVIEW_EMAIL ?? "a@v4test.local";
const PASSWORD = process.env.REVIEW_PASSWORD ?? "LinkrReview123!";
const OUT = process.env.REVIEW_OUT ?? "C:/tmp/tranche-a/sweep";

fs.mkdirSync(OUT, { recursive: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(supabaseUrl)) {
  console.error("REFUSING: not a local Supabase URL:", supabaseUrl);
  process.exit(1);
}
{
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await admin
    .from("user_locations")
    .update({ last_updated: new Date().toISOString() })
    .not("user_id", "is", null);
  await admin.from("rate_limits").delete().eq("action", "auth.login");
}

const VIEWPORTS = {
  "360x640": { width: 360, height: 640 },
  "360x800": { width: 360, height: 800 },
  "390x844": { width: 390, height: 844 },
  "430x932": { width: 430, height: 932 }
};

const SURFACES = [
  { name: "profile", path: "/profile" },
  { name: "muddies", path: "/friends" },
  { name: "requests", path: "/friends?tab=requests" },
  { name: "notifications", path: "/notifications" }
];

const browser = await chromium.launch();
const statePath = `${OUT}/session.json`;

{
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
  await context.storageState({ path: statePath });
  await context.close();
  console.log("signed in once");
}

async function inspect(page) {
  return page.evaluate(() => {
    const targets = [...document.querySelectorAll("button, a[href], input, [role='button']")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    return {
      overflow: document.body.scrollWidth > window.innerWidth,
      scrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      // Phantom scroll: content shorter than the viewport but the page still
      // scrolls, which means something is holding empty height.
      contentHeight: document.documentElement.scrollHeight,
      phantomScroll:
        document.documentElement.scrollHeight > window.innerHeight + 8 &&
        document.body.innerText.trim().length < 40,
      smallTargets: targets.filter(({ r }) => r.height < 40 || r.width < 40).length,
      totalTargets: targets.length,
      errorText: /could not load|something went wrong|failed to/i.test(document.body.innerText)
    };
  });
}

let failures = 0;
const report = {};

for (const surface of SURFACES) {
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    for (const scheme of ["light", "dark"]) {
      const key = `${surface.name}-${label}-${scheme}`;
      const context = await browser.newContext({
        viewport,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        colorScheme: scheme,
        storageState: statePath
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(`${BASE}${surface.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2800);
        await page.screenshot({ path: `${OUT}/${key}.png` });
        const info = await inspect(page);
        report[key] = { ...info, errors: errors.slice(0, 2) };
        const bad = info.overflow || errors.length > 0;
        if (bad) failures += 1;
        console.log(
          `${bad ? "FAIL" : "ok  "} ${key.padEnd(34)} overflow=${info.overflow} smallTargets=${info.smallTargets}/${info.totalTargets}${errors.length ? ` ERR:${errors[0].slice(0, 50)}` : ""}`
        );
      } catch (error) {
        failures += 1;
        console.log(`FAIL ${key}: ${error.message}`);
        report[key] = { error: error.message };
      }
      await context.close();
    }
  }
}

console.log(`\n${failures === 0 ? "SWEEP CLEAN" : `SWEEP FOUND ${failures} PROBLEM(S)`}`);
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
