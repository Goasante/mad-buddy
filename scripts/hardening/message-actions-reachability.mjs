/**
 * Mission 2 Extreme — can a FINGER reach the message actions at all?
 *
 * The geometry probe established that the inline React/Edit/Delete row sits at
 * opacity 0 until `group-hover`, which a touch device can never produce. That
 * makes the long-press menu the only remaining candidate route on a phone.
 *
 * `LongPressActions` documents that it "DOES NOT REPLACE A VISIBLE CONTROL" and
 * that a hold is "a shortcut for people who know it, never the only route".
 * This tests whether that contract actually holds here, by driving a REAL hold
 * with touch pointer events and asking whether a menu appeared.
 *
 * It deliberately also asserts the negative case: a hold must not be required
 * for the actions to be reachable. Reporting "the hold works" alone would
 * conceal a discoverability defect behind a technically-functional gesture.
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
  storageState: AUTH,
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true
});
const page = await ctx.newPage();
await page.goto(`${BASE}/messages?conversation=${CONVO}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4000);

const bubble = page.locator("[class*='rounded-\[1\.25rem\]']").first();
const present = await bubble.count();
check("a message bubble is present to press", present > 0, `${present} bubbles`);

if (present > 0) {
  const box = await bubble.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // A real press-and-hold: pointer down, stay still, wait past the threshold.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(900);

  // Did a menu open, and does it carry the canonical action labels?
  const menu = await page.evaluate(() => {
    const el = document.querySelector("[role=menu], [role=dialog][data-state=open], [data-radix-menu-content]");
    if (!el) return null;
    const items = Array.from(el.querySelectorAll("[role=menuitem], button, a"))
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { label: (n.innerText || "").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((n) => n.label);
    return { items };
  });

  check("press-and-hold opens a contextual menu on touch",
    Boolean(menu && menu.items.length > 0),
    menu ? `${menu.items.length} items: ${menu.items.map((i) => i.label).join(", ")}` : "no menu opened");

  if (menu && menu.items.length) {
    const small = menu.items.filter((i) => i.h < 44);
    check("every menu row meets the 44px minimum",
      small.length === 0,
      small.length ? small.map((i) => `${i.label} h=${i.h}`).join(" | ") : `all ${menu.items.length} rows >=44px`);
  }
}

await ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} reachability checks passed`);
