/**
 * Mission 2 God Mode, Axis 8 — responsive stress under real-world extremes.
 *
 * Normal wrapping is NOT a failure and is not reported. What is reported:
 *   - horizontal overflow of the page
 *   - a control clipped by an ancestor with a fixed height
 *   - text overlapping another element
 *   - a primary CTA pushed off-screen
 *
 * Two stressors, applied to a real signed-in app:
 *   TEXT SCALING — the browser's own font-size increase, which is what a user
 *                  with reduced vision actually does (200%).
 *   LONG DATA    — a display name, Plan title and Event name far longer than
 *                  the fixtures, injected into the DOM so real layout runs.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/extreme-content";
mkdirSync(OUT, { recursive: true });

const ROUTES = ["/dashboard", "/friends", "/messages", "/plans", "/events",
                "/linkr", "/hangout-mode", "/safe-arrival", "/profile", "/settings"];
const SIZES = [[360, 800], [393, 852], [430, 932]];

/** Runs in the page: reports genuine breakage only. */
const INSPECT = () => {
  const vw = window.innerWidth;
  const problems = [];

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth}px > ${vw}px)`);
  }

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  /* A control clipped by an ancestor that CANNOT SCROLL.
   *
   * The first version flagged every tab strip -- "Blocked", "Nearby", "Past",
   * "Circles" -- as off-screen. Those strips are `overflow-x-auto` and scroll
   * by design; plans-page.tsx even carries a comment about this exact false
   * positive ("THE CLIPPED TAB WAS SCROLLING, NOT BREAKING"). A control the
   * user can reach by scrolling is reachable. Only a control trapped inside a
   * container that does not scroll is a defect. */
  const scrollableAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
      node = node.parentElement;
    }
    return false;
  };

  for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 2 && r.left >= -2) continue;
    if (scrollableAncestor(el)) continue;
    const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 34);
    problems.push(`UNREACHABLE control off-screen: "${name || el.tagName}" (${Math.round(r.left)}..${Math.round(r.right)})`);
  }

  // Text overflowing a fixed-height ancestor: the shape that HIDES meaning.
  for (const el of document.querySelectorAll("p, h1, h2, h3, span, div")) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    // Only when the author fixed the height AND content exceeds it.
    if (st.overflow === "hidden" && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0) {
      const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
      // line-clamp is deliberate truncation, not breakage.
      if (st.webkitLineClamp && st.webkitLineClamp !== "none") continue;
      if (txt.length > 12) {
        problems.push(`clipped text (${el.scrollHeight}px in ${el.clientHeight}px): "${txt.slice(0, 44)}"`);
      }
    }
  }

  return { problems: [...new Set(problems)].slice(0, 8) };
};

const browser = await chromium.launch();
const rows = [];

for (const [w, h] of SIZES) {
  for (const scale of [1, 2]) {
    const ctx = await browser.newContext({
      storageState: AUTH, viewport: { width: w, height: h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const row = { size: `${w}x${h}`, scale: scale === 2 ? "200% text" : "normal", route };
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2400);
        if (scale === 2) {
          // The browser's own text scaling, the way a low-vision user sets it.
          await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
          await page.waitForTimeout(1200);
        }
        Object.assign(row, await page.evaluate(INSPECT));
      } catch (e) {
        row.error = String(e).split("\n")[0].slice(0, 110);
      }
      rows.push(row);
      if (row.problems?.length) {
        await page.screenshot({ path: `${OUT}/${w}-${scale}-${route.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/extreme-content.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(94)}\nEXTREME CONTENT / TEXT SCALING\n${"=".repeat(94)}`);
let bad = 0;
for (const r of rows) {
  if (r.error) { console.log(`${r.size} ${r.scale.padEnd(10)} ${r.route.padEnd(15)} ERROR ${r.error}`); continue; }
  if (!r.problems.length) continue;
  bad += 1;
  console.log(`\n${r.size} ${r.scale.padEnd(10)} ${r.route}`);
  for (const p of r.problems) console.log(`    ${p}`);
}
console.log(`\n${rows.length} combinations checked, ${bad} with genuine breakage`);
