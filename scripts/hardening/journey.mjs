/**
 * End-to-end journey driver.
 *
 * Mission 1's mutation audit and Mission 3's flow work both need real clicks on
 * real controls, not fetch() calls: a server action existing does not prove the
 * button reaches it. This drives named controls in sequence and reports what
 * actually happened to the URL, the DOM and the console at each step.
 *
 * Steps are described declaratively so a journey reads like the user's intent:
 *   { do: "click", text: "Message" }
 *   { do: "expect-url", contains: "/messages" }
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const SHOTS = "C:/mb-god/.hardening/journeys";
mkdirSync(SHOTS, { recursive: true });

export async function runJourney(name, steps, options = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    ...(options.anonymous ? {} : { storageState: AUTH })
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Content Security Policy|CHANNEL_ERROR|realtime|orb-off|profile\/avatar/i.test(t)) return;
    errors.push(t.slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR " + String(e).slice(0, 200)));

  const log = [];
  let failed = false;

  for (const [i, step] of steps.entries()) {
    const label = `${step.do}${step.text ? ` "${step.text}"` : ""}${step.url ? ` ${step.url}` : ""}`;
    try {
      if (step.do === "goto") {
        await page.goto(`${BASE}${step.url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(step.wait ?? 1800);
      } else if (step.do === "click") {
        // Prefer an exact accessible name, fall back to visible text.
        const byRole = page.getByRole(step.role || "button", { name: step.text, exact: false }).first();
        const target = (await byRole.count()) ? byRole : page.getByText(step.text, { exact: false }).first();
        await target.click({ timeout: step.timeout ?? 15000 });
        await page.waitForTimeout(step.wait ?? 2200);
      } else if (step.do === "fill") {
        await page.locator(step.selector).first().fill(step.value, { timeout: 15000 });
      } else if (step.do === "expect-url") {
        const u = page.url();
        if (!u.includes(step.contains)) throw new Error(`url "${u}" does not contain "${step.contains}"`);
      } else if (step.do === "expect-text") {
        const body = await page.locator("body").innerText();
        if (!body.toLowerCase().includes(step.contains.toLowerCase())) {
          throw new Error(`page text does not contain "${step.contains}"`);
        }
      } else if (step.do === "expect-no-text") {
        const body = await page.locator("body").innerText();
        if (body.toLowerCase().includes(step.contains.toLowerCase())) {
          throw new Error(`page text unexpectedly contains "${step.contains}"`);
        }
      } else if (step.do === "shot") {
        await page.screenshot({ path: `${SHOTS}/${name}-${i}-${step.text || "step"}.png` });
      }
      log.push(`  ok   ${label}  -> ${new URL(page.url()).pathname}`);
    } catch (e) {
      failed = true;
      log.push(`  FAIL ${label}  -> ${String(e).split("\n")[0].slice(0, 160)}`);
      await page.screenshot({ path: `${SHOTS}/${name}-FAIL-${i}.png` }).catch(() => {});
      break;
    }
  }

  console.log(`\n### JOURNEY: ${name} — ${failed ? "FAILED" : "passed"}`);
  for (const line of log) console.log(line);
  if (errors.length) {
    console.log(`  console errors (${errors.length}):`);
    for (const e of [...new Set(errors)].slice(0, 4)) console.log(`    ${e}`);
  }

  await browser.close();
  return !failed;
}

// Allow running a journey file directly.
if (process.argv[1]?.endsWith("journey.mjs")) {
  console.log("This module is imported by journey scripts; run one of those instead.");
}
