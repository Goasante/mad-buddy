/**
 * My Progress IA rebuild -- viewport/theme/product-state visual matrix.
 *
 * Logs into each seeded fixture user (see scripts/seed-my-progress-fixture.mjs)
 * and screenshots /buddy-score across the widths and states the review brief
 * calls for. Also captures full-page height so the "established user page
 * must be visibly shorter" claim can be checked against a number, not just
 * eyeballed.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MY_PROGRESS_BASE_URL ?? "http://127.0.0.1:3001";
const OUT = ".review-screenshots";
mkdirSync(OUT, { recursive: true });

const USERS = {
  early: "progress-early@fixture.local",
  active: "progress-active@fixture.local",
  established: "progress-established@fixture.local",
  full: "progress-full@fixture.local"
};
const PASSWORD = "MyProgressReview123!";

const VIEWPORTS = [
  { name: "320", width: 320, height: 720 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 }
];

const fails = [];
let shots = 0;

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
}

async function shootState(stateName, email, viewport, theme) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", stateName, e.message.slice(0, 140)));

  try {
    await login(page, email);
    await page.goto(`${BASE}/buddy-score`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        fullHeight: doc.scrollHeight,
        headers: document.querySelectorAll("header").length,
        hasSummary: Boolean(document.querySelector('[aria-labelledby="progress-summary-title"]')),
        hasJourney: Boolean(document.querySelector('[aria-labelledby="progress-journey-title"]')),
        hasAchievements: Boolean(document.querySelector('[aria-labelledby="progress-achievements-title"]')),
        hasMilestones: Boolean(document.querySelector('[aria-labelledby="progress-milestones-title"]')),
        hasActivity: Boolean(document.querySelector('[aria-labelledby="progress-activity-title"]')),
        bodyScrollX: document.body.scrollWidth - document.body.clientWidth
      };
    });

    const fileName = `${OUT}/my-progress--${stateName}--${theme}--${viewport.name}.png`;
    await page.screenshot({ path: fileName, fullPage: true });
    shots += 1;

    const ok = metrics.headers <= 1 && metrics.bodyScrollX <= 2 && metrics.hasSummary && metrics.hasJourney;
    if (!ok) fails.push(`${stateName} ${viewport.name} ${theme} ${JSON.stringify(metrics)}`);
    console.log(
      `${ok ? "PASS" : "FAIL"} ${stateName} ${viewport.name} ${theme} fullHeight=${metrics.fullHeight} headers=${metrics.headers} scrollX=${metrics.bodyScrollX}`
    );
    return metrics.fullHeight;
  } catch (error) {
    console.log("ERROR", stateName, viewport.name, theme, error.message.slice(0, 160));
    fails.push(`${stateName} ${viewport.name} ${theme} ERROR: ${error.message.slice(0, 160)}`);
    return null;
  } finally {
    await browser.close();
  }
}

const heights = {};

// Primary matrix: 390 dark + light, plus 320/430 dark, across all four states.
for (const [stateName, email] of Object.entries(USERS)) {
  heights[stateName] = heights[stateName] ?? {};
  for (const theme of ["dark", "light"]) {
    const h = await shootState(stateName, email, VIEWPORTS.find((v) => v.name === "390"), theme);
    heights[stateName][`390-${theme}`] = h;
  }
  for (const vpName of ["320", "375", "430"]) {
    const h = await shootState(stateName, email, VIEWPORTS.find((v) => v.name === vpName), "dark");
    heights[stateName][`${vpName}-dark`] = h;
  }
}

console.log(`\nSHOTS=${shots} FAIL=${fails.length}`);
for (const f of fails) console.log("  FAIL:", f);

console.log("\nFULL-PAGE HEIGHTS (px, 390 dark):");
for (const [state, h] of Object.entries(heights)) {
  console.log(`  ${state}: ${h["390-dark"]}`);
}
