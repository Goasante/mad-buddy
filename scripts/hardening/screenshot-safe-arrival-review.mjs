/**
 * Runtime visual verification for the Safe Arrival intro UX polish, against a
 * production build served with `next start` (never `next dev`) and the
 * isolated local Supabase stack seeded by seed-safe-arrival-review.mjs.
 *
 * Captures: intro (390 dark, 390 light, 320), setup steps, active in-transit,
 * extended, grace/waiting, overdue/unconfirmed. Saves to .review-screenshots/
 * (gitignored). Also captures console/page errors per page.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "C:/Users/Godfred Ofosu Asante/Desktop/mb-safe-arrival-ux/.review-screenshots";
mkdirSync(OUT, { recursive: true });

const PASSWORD = "SafeArrivalReview!2026";

const errors = [];
function trackErrors(page, tag) {
  page.on("pageerror", (e) => errors.push(`${tag}: pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${tag}: console: ${m.text().slice(0, 160)}`);
  });
}

async function loginContext(browser, { email, viewport, colorScheme }) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    colorScheme
  });
  const page = await ctx.newPage();
  trackErrors(page, email);
  // Exactly ONE attempt: the login action is rate-limited server-side, and a
  // retry loop here previously tripped that limiter and poisoned every later
  // login in the same run (see local-db-fixture-hygiene). If this one attempt
  // does not land, the caller records LOGIN FAILED and moves on.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
  const loggedIn = !new URL(page.url()).pathname.startsWith("/login");
  return { ctx, page, loggedIn };
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("captured:", name);
}

const browser = await chromium.launch({ headless: true });
const results = [];

// ---------------------------------------------------------------------------
// 1. Intro screen: 390 dark, 390 light, 320 narrow (Ama: fresh account).
// ---------------------------------------------------------------------------
for (const { tag, viewport, colorScheme } of [
  { tag: "intro-390-dark", viewport: { width: 390, height: 844 }, colorScheme: "dark" },
  { tag: "intro-390-light", viewport: { width: 390, height: 844 }, colorScheme: "light" },
  { tag: "intro-320-narrow", viewport: { width: 320, height: 720 }, colorScheme: "dark" }
]) {
  const { ctx, page, loggedIn } = await loginContext(browser, {
    email: "ama.ready@review.local",
    viewport,
    colorScheme
  });
  if (!loggedIn) {
    results.push(`${tag}: LOGIN FAILED`);
    await ctx.close();
    continue;
  }
  await page.goto(`${BASE}/safe-arrival`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1000);
  const bodyText = await page.locator("body").innerText();
  results.push(`${tag}: entry CTA text = "${(bodyText.match(/Set up Safe Arrival|Start Safe Arrival/i) || ["MISSING"])[0]}"`);
  await shot(page, tag);

  // Overflow check.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  results.push(`${tag}: horizontal overflow = ${overflow}`);

  if (tag === "intro-390-dark") {
    // "How it works" -> modal must render fully, not clipped by bottom nav.
    const howLink = page.getByRole("button", { name: "How it works" });
    await howLink.click();
    await page.waitForTimeout(500);
    await shot(page, "how-it-works-modal-390-dark");
    const dialog = page.locator("[role='dialog']");
    const dialogBox = await dialog.boundingBox();
    const viewportHeight = viewport.height;
    results.push(
      `how-it-works modal bottom = ${dialogBox ? dialogBox.y + dialogBox.height : "N/A"} vs viewport height ${viewportHeight}`
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Open setup sheet and walk through Details -> Contacts -> Review.
    await page.getByRole("button", { name: /Set up Safe Arrival/i }).first().click();
    await page.waitForTimeout(700);
    await shot(page, "setup-details-390-dark");
    const setupDialog = page.locator("[role='dialog']");
    await setupDialog.locator("input").first().fill(
      "The East Legon Hills gated community clubhouse, all the way past the third roundabout"
    );
    const t = new Date(Date.now() + 3 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    await setupDialog.locator("input[type='time']").first().fill(`${pad(t.getHours())}:${pad(t.getMinutes())}`);
    await page.waitForTimeout(400);
    await setupDialog.locator("button", { hasText: "30 min" }).first().click();
    await page.waitForTimeout(300);
    await shot(page, "setup-details-filled-390-dark");
    await setupDialog.locator("button", { hasText: "Next: Choose Contacts" }).first().click();
    await page.waitForTimeout(800);
    await shot(page, "setup-contacts-390-dark");
    // Long-named Muddy should be visible and truncate cleanly.
    const longNameVisible = await setupDialog.locator("text=Nana Akosua").count();
    results.push(`setup-contacts: long-name Muddy row present = ${longNameVisible > 0}`);
    await setupDialog.locator("button", { hasText: "Nana Akosua" }).first().click();
    await page.waitForTimeout(400);
    await setupDialog.locator("button", { hasText: "Next: Review" }).first().click();
    await page.waitForTimeout(700);
    await shot(page, "setup-review-390-dark");
    const reviewText = await setupDialog.innerText();
    results.push(`setup-review: privacy line present = ${/No live location is shared/i.test(reviewText)}`);
    results.push(`setup-review: CTA text = "${(reviewText.match(/Start Safe Arrival/i) || ["MISSING"])[0]}"`);
  }

  await ctx.close();
}

// ---------------------------------------------------------------------------
// 2. Active journey states.
// ---------------------------------------------------------------------------
for (const { tag, email, viewport } of [
  { tag: "active-in-transit-390", email: "kojo.transit@review.local", viewport: { width: 390, height: 844 } },
  { tag: "active-extended-390", email: "efua.extended@review.local", viewport: { width: 390, height: 844 } },
  { tag: "active-grace-waiting-390", email: "yaw.grace@review.local", viewport: { width: 390, height: 844 } },
  { tag: "active-overdue-390", email: "abena.overdue@review.local", viewport: { width: 390, height: 844 } }
]) {
  const { ctx, page, loggedIn } = await loginContext(browser, { email, viewport, colorScheme: "dark" });
  if (!loggedIn) {
    results.push(`${tag}: LOGIN FAILED`);
    await ctx.close();
    continue;
  }
  await page.goto(`${BASE}/safe-arrival`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(1200);
  const statusText = await page.locator("body").innerText();
  const statusMatch = statusText.match(/IN TRANSIT|EXTENDED|NOT CONFIRMED|ARRIVED|ENDED/);
  results.push(`${tag}: status chip = ${statusMatch ? statusMatch[0] : "NOT FOUND"}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  results.push(`${tag}: horizontal overflow = ${overflow}`);
  await shot(page, tag);
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 3. 375px and 430px intro checks for the responsive matrix.
// ---------------------------------------------------------------------------
for (const { tag, width } of [
  { tag: "intro-375", width: 375 },
  { tag: "intro-430", width: 430 }
]) {
  const { ctx, page, loggedIn } = await loginContext(browser, {
    email: "ama.ready@review.local",
    viewport: { width, height: 844 },
    colorScheme: "dark"
  });
  if (!loggedIn) {
    results.push(`${tag}: LOGIN FAILED`);
    await ctx.close();
    continue;
  }
  await page.goto(`${BASE}/safe-arrival`, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  results.push(`${tag}: horizontal overflow = ${overflow}`);
  await shot(page, tag);
  await ctx.close();
}

await browser.close();

console.log("\n=== RESULTS ===");
for (const r of results) console.log(r);
console.log("\n=== ERRORS (page/console) ===");
console.log(errors.length === 0 ? "none" : errors.join("\n"));
console.log(`\n${errors.length} error(s) captured across all pages.`);
