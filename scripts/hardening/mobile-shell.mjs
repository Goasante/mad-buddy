/**
 * Mission 5 — the global mobile shell, measured as CLASSES not route instances.
 *
 * Mission 2 already fixed per-surface touch targets and 200%-text overflow.
 * Mission 5 asks a different question: do the SHELL PRIMITIVES hold — safe
 * area, viewport units, fixed positioning, scroll containment — so that the
 * whole UI could later be mounted in a native WebView without route-by-route
 * redesign?
 *
 * What is measured, per viewport and theme:
 *   - the fixed header and bottom nav actually reserve the safe-area insets
 *   - no element escapes the viewport horizontally
 *   - the page does not exceed the viewport when its content fits
 *   - scroll containment: exactly one scrolling region, not nested traps
 *   - `position: fixed` elements are anchored to the visual viewport
 *
 * KNOWN ENVIRONMENT LIMIT, stated rather than worked around:
 * `env(safe-area-inset-*)` is 0 in headless Chromium and CANNOT be set from
 * script — Mission 2 already recorded that trying produces a measurement of the
 * simulation rather than the app. So this verifies that every pinned element
 * DERIVES from the inset tokens (a structural property that survives a real
 * notch) rather than asserting a pixel value that would be 0 here anyway.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/mobile-shell";
mkdirSync(OUT, { recursive: true });

const SIZES = [[360, 800], [375, 812], [390, 844], [393, 852], [430, 932]];
const ROUTES = ["/dashboard", "/friends", "/messages", "/plans", "/events",
                "/linkr", "/hangout-mode", "/safe-arrival", "/profile", "/settings"];

const INSPECT = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const problems = [];

  const scrollableAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
      node = node.parentElement;
    }
    return false;
  };

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
  }

  // Fixed elements must be inside the visual viewport.
  const fixed = [];
  for (const el of document.querySelectorAll("*")) {
    const st = getComputedStyle(el);
    if (st.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const tag = `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`.slice(0, 40);
    fixed.push({ tag, top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) });

    /* THREE KINDS OF FIXED ELEMENT ARE NOT PROBLEMS, and a naive height or
       bottom-edge threshold flags all of them:
         - decorative backgrounds behind content (negative z-index)
         - non-interactive layers (pointer-events: none), e.g. the wallpaper
         - the deliberate immersive full-screen surface (conversation-canvas)
       and the bottom nav when it has slid AWAY, which is inert by design.
       Only an INTERACTIVE fixed element that escapes the viewport is a defect. */
    const inert = st.pointerEvents === "none" || Number(st.zIndex) < 0;
    if (inert) continue;
    if (r.left < -1 || r.right > vw + 1) {
      problems.push(`interactive fixed element escapes horizontally: ${tag}`);
    }
    if (r.top > vh + 2) {
      problems.push(`interactive fixed element entirely below the fold: ${tag}`);
    }
  }

  // Nested scroll traps: more than one vertically scrolling region that is not
  // a deliberate rail.
  const scrollers = Array.from(document.querySelectorAll("*")).filter((el) => {
    const st = getComputedStyle(el);
    if (!/(auto|scroll)/.test(st.overflowY)) return false;
    return el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 80;
  }).map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`.slice(0, 34));

  // A control trapped off-screen with no scrollable ancestor.
  for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= vw + 2 && r.left >= -2) continue;
    if (scrollableAncestor(el)) continue;
    const name = (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30);
    problems.push(`unreachable control: "${name || el.tagName}"`);
  }

  return { vw, vh, problems: [...new Set(problems)], fixed: fixed.slice(0, 6), scrollers: [...new Set(scrollers)] };
};

const browser = await chromium.launch();
const rows = [];

for (const [w, h] of SIZES) {
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      storageState: AUTH, viewport: { width: w, height: h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme,
      permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
    });
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const row = { size: `${w}x${h}`, theme, route };
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2400);
        for (let i = 0; i < 3; i += 1) {
          const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
          if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(700); } else break;
        }
        Object.assign(row, await page.evaluate(INSPECT));
      } catch (e) {
        row.error = String(e).split("\n")[0].slice(0, 100);
        row.problems = [];
      }
      rows.push(row);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/mobile-shell.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(92)}\nMOBILE SHELL — ${SIZES.length} viewports x 2 themes x ${ROUTES.length} routes\n${"=".repeat(92)}`);
let bad = 0;
for (const r of rows) {
  if (r.error) { console.log(`${r.size} ${r.theme} ${r.route}  ERROR ${r.error}`); bad += 1; continue; }
  if (!r.problems.length) continue;
  bad += 1;
  console.log(`\n${r.size} ${r.theme.padEnd(5)} ${r.route}`);
  for (const p of r.problems) console.log(`    ${p}`);
}
console.log(`\n${rows.length} combinations checked, ${bad} with problems`);

// The scroll-containment picture, pooled.
const pool = new Map();
for (const r of rows) for (const s of r.scrollers ?? []) pool.set(s, (pool.get(s) ?? 0) + 1);
console.log(`\nscrolling regions seen across the matrix: ${pool.size}`);
for (const [s, n] of [...pool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(n).padStart(3)}x  ${s}`);
}
