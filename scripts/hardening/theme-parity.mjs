/**
 * Mission 2 God Mode, Axis 9 — dark/light parity, and Axis 2's colour question.
 *
 * Two things measured together because they share a capture:
 *   1. Does every surface render sanely in BOTH themes?
 *   2. Where hardcoded Tailwind palette oranges sit beside the brand token, do
 *      they actually read as different colours on screen?
 *
 * Hex arithmetic says orange-400 (#fb923c) is 26 rgb units from brand
 * (#e88c2b). Whether that is visible next to each other is a question for a
 * rendered pixel, not a spreadsheet.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/theme-parity";
mkdirSync(OUT, { recursive: true });

const ROUTES = ["/dashboard", "/friends", "/messages", "/plans", "/events",
                "/linkr", "/hangout-mode", "/safe-arrival", "/profile",
                "/settings", "/notifications", "/groups"];

const browser = await chromium.launch();
const rows = [];

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    storageState: AUTH, viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme,
    permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const row = { theme, route };
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2600);
      Object.assign(row, await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const px = (c) => {
          const m = c.match(/rgba?\(([^)]+)\)/);
          return m ? m[1].split(",").slice(0, 3).map((n) => Number(n.trim())) : null;
        };
        const lum = (rgb) => rgb ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 : null;

        // Every distinct "orange-ish" colour actually painted on this page.
        const oranges = new Map();
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const st = getComputedStyle(el);
          for (const prop of ["color", "backgroundColor", "borderTopColor"]) {
            const rgb = px(st[prop]);
            if (!rgb) continue;
            const [rr, gg, bb] = rgb;
            // Warm, saturated, not grey: the brand family's neighbourhood.
            if (rr > 180 && gg > 90 && gg < 200 && bb < 120 && rr - bb > 90) {
              const key = `${rr},${gg},${bb}`;
              oranges.set(key, (oranges.get(key) ?? 0) + 1);
            }
          }
        }
        /* `body` is deliberately transparent -- the app paints its ground on a
           wrapper -- so comparing body.backgroundColor across themes compares
           nothing and reports every route as "identical". The EFFECTIVE ground
           is what the viewport actually shows, so walk up from the first real
           painted ancestor. */
        const painted = (() => {
          for (const el of [document.querySelector("#app-main-content"), document.querySelector("main"),
                            document.documentElement, document.body]) {
            if (!el) continue;
            const c = getComputedStyle(el).backgroundColor;
            if (c && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(c)) return c;
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        })();
        return {
          painted,
          bg: body.backgroundColor,
          fg: body.color,
          bgLum: lum(px(body.backgroundColor)),
          fgLum: lum(px(body.color)),
          oranges: [...oranges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        };
      }));
      await page.screenshot({ path: `${OUT}/${theme}-${route.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true });
    } catch (e) {
      row.error = String(e).split("\n")[0].slice(0, 110);
    }
    rows.push(row);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/theme-parity.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(94)}\nTHEME PARITY\n${"=".repeat(94)}`);
console.log("route            theme   body bg              contrast(lum delta)  distinct warm colours");
for (const r of rows) {
  if (r.error) { console.log(`${r.route.padEnd(16)} ${r.theme.padEnd(7)} ERROR ${r.error}`); continue; }
  const delta = (r.bgLum !== null && r.fgLum !== null) ? Math.abs(r.bgLum - r.fgLum).toFixed(2) : "?";
  console.log(`${r.route.padEnd(16)} ${r.theme.padEnd(7)} ${String(r.bg).padEnd(20)} ${String(delta).padEnd(20)} ${r.oranges.length}`);
}

// Does the theme actually change? A "dark mode" that renders identically is
// the failure this would catch.
console.log(`\nTHEME ACTUALLY DIFFERS PER ROUTE`);
for (const route of ROUTES) {
  const l = rows.find((r) => r.route === route && r.theme === "light");
  const d = rows.find((r) => r.route === route && r.theme === "dark");
  if (!l || !d || l.error || d.error) continue;
  /* Compare the EFFECTIVE ground and the text/ground luminance gap. A theme
     that truly failed to switch would match on both. */
  const sameGround = l.painted === d.painted;
  const lumMoved = Math.abs((l.bgLum ?? 0) - (d.bgLum ?? 0)) > 0.2 ||
                   Math.abs((l.fgLum ?? 0) - (d.fgLum ?? 0)) > 0.2;
  console.log(`  ${route.padEnd(16)} ${sameGround && !lumMoved
    ? "⚠ IDENTICAL in both themes"
    : `light ${l.painted} → dark ${d.painted}   (text luminance ${(l.fgLum ?? 0).toFixed(2)} → ${(d.fgLum ?? 0).toFixed(2)})`}`);
}

// The warm palette actually painted, pooled.
const pool = new Map();
for (const r of rows) for (const [c, n] of r.oranges ?? []) pool.set(c, (pool.get(c) ?? 0) + n);
console.log(`\nDISTINCT WARM COLOURS PAINTED ACROSS THE PRODUCT: ${pool.size}`);
for (const [c, n] of [...pool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  const [r, g, b] = c.split(",").map(Number);
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  console.log(`  rgb(${c})  ${hex}  ${n} elements`);
}
