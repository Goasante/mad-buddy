/**
 * Does choosing "React" from the long-press menu actually let a finger react?
 *
 * The emoji picker renders INSIDE the same `opacity-0 group-hover:opacity-100`
 * row as the inline actions (messages-page.tsx:1539). If that holds, then the
 * one action the long-press menu offers to everyone — React — leads to an
 * invisible picker on touch, and the menu route is broken too.
 *
 * This is the difference between "actions are undiscoverable" and "one action
 * is unusable". Worth knowing before choosing the fix.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const CONVO = process.env.MB_CONVO || "f680b597-ac71-4c12-b3cb-7968f87084f4";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true
});
const page = await ctx.newPage();
await page.goto(`${BASE}/messages?conversation=${CONVO}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

const bubble = page.locator("[class*='rounded-\[1\.25rem\]']").first();
const box = await bubble.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
await page.waitForTimeout(800);

const reactItem = page.locator("[role=menuitem]", { hasText: /^React$/ }).first();
const found = await reactItem.count();
check("the long-press menu offers React", found > 0, `${found} matching items`);

if (found) {
  await reactItem.click();
  await page.waitForTimeout(900);

  // The picker is the row of emoji buttons labelled "React with <id>".
  const picker = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button[aria-label^='React with']"));
    return btns.map((b) => {
      const r = b.getBoundingClientRect();
      let op = 1, el = b;
      while (el && el !== document.body) { op *= Number(getComputedStyle(el).opacity); el = el.parentElement; }
      return { label: b.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height), effOpacity: +op.toFixed(3) };
    });
  });

  check("choosing React reveals an emoji picker in the DOM",
    picker.length > 0, `${picker.length} emoji buttons`);

  const visible = picker.filter((p) => p.effOpacity > 0.01);
  check("the emoji picker is VISIBLE on touch after choosing React",
    picker.length > 0 && visible.length === picker.length,
    `${visible.length}/${picker.length} visible; opacities ${[...new Set(picker.map((p) => p.effOpacity))].join(",")}`);

  const big = picker.filter((p) => p.h >= 44 && p.w >= 44);
  check("emoji targets meet the 44px minimum",
    picker.length > 0 && big.length === picker.length,
    `${big.length}/${picker.length}; sizes ${[...new Set(picker.map((p) => `${p.w}x${p.h}`))].join(" ")}`);
}

await ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} react-picker checks passed`);
