/**
 * MB-GOD-059 — how long the landing page actually is, per section.
 *
 * Mission 2 recorded "9.46 screens" as a single number. To decide what to cut
 * in order to make room for Linkr and UpFor, the number has to be broken down:
 * which sections cost the most, and which repeat each other.
 *
 * Measured on a real 390x844 phone viewport, both themes, because the length
 * debt is a mobile problem — on desktop the same content is far shorter.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const SIZES = [[390, 844], [1280, 800]];

const MEASURE = () => {
  const vh = window.innerHeight;
  const sections = [...document.querySelectorAll("main > section, main > footer")].map((el) => {
    const r = el.getBoundingClientRect();
    const h = r.height;
    // The heading is how a reader would name this section.
    const heading = (el.querySelector("h1, h2")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 46);
    return { id: el.id || el.tagName.toLowerCase(), heading, px: Math.round(h), screens: +(h / vh).toFixed(2) };
  });
  return {
    vh,
    total: Math.round(document.documentElement.scrollHeight),
    totalScreens: +(document.documentElement.scrollHeight / vh).toFixed(2),
    sections
  };
};

const browser = await chromium.launch();
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 2
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  // Reveal animations gate on IntersectionObserver; scroll the whole page so
  // every section has its final height rather than its pre-reveal height.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
  const m = await page.evaluate(MEASURE);

  console.log(`\n${"=".repeat(82)}\n${w}x${h}  —  ${m.totalScreens} screens total (${m.total}px)\n${"=".repeat(82)}`);
  console.log(`${"section".padEnd(20)}${"screens".padStart(9)}${"px".padStart(8)}   heading`);
  for (const s of m.sections) {
    const bar = "#".repeat(Math.min(30, Math.round(s.screens * 8)));
    console.log(`${s.id.padEnd(20)}${String(s.screens).padStart(9)}${String(s.px).padStart(8)}   ${bar} ${s.heading}`);
  }
  await ctx.close();
}
await browser.close();
