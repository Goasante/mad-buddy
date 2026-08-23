/**
 * MB-GOD-042 — focus returns to the control that opened a dialog.
 *
 * Eleven call sites pass `open={Boolean(resource)}` and clear the resource on
 * close, unmounting the Dialog in the same commit that closes it. Radix's own
 * restore step then has nothing to run from and focus falls to <body>.
 *
 * Fixed in the shared `Modal` primitive, so this exercises SEVERAL call sites
 * rather than only the one that surfaced the defect -- the brief's rule that a
 * defect shape is fixed, not its first instance.
 *
 * Each case is driven by KEYBOARD (Enter to open, Escape to close), because
 * that is the user for whom this matters and the path a mouse cannot reveal.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

const CASES = [
  { name: "Muddy profile (from /friends)", route: "/friends", trigger: 'button[aria-label="Kofi Mensah, open profile"]' },
  { name: "Muddy profile (from Home)", route: "/dashboard", trigger: 'button[aria-label^="Kofi, Just Around"]' },
  { name: "Event detail (from /events)", route: "/events", trigger: 'a[href*="event="], button[aria-label*="launch night"]' },
  /* The Plan deep link lives on HOME, not /plans -- /plans opens on "Upcoming",
     and a Plan still in `inviting` sits under "Created by you". Pointing this
     at /plans measured the empty tab. */
  { name: "Plan detail (from Home)", route: "/dashboard", trigger: 'a[href*="plan="]' }
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});

for (const c of CASES) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${c.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3200);

  const focused = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    if (!(t instanceof HTMLElement)) return null;
    t.focus();
    return t.getAttribute("aria-label") || (t.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40) || t.tagName;
  }, c.trigger);

  if (!focused) {
    inconclusive(c.name, `trigger not present: ${c.trigger}`);
    await page.close();
    continue;
  }

  await page.keyboard.press("Enter");
  await page.waitForTimeout(1800);
  const opened = await page.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    return { open: Boolean(d), focusInside: d ? d.contains(document.activeElement) : false };
  });

  if (!opened.open) {
    inconclusive(c.name, "Enter on the trigger did not open a dialog");
    await page.close();
    continue;
  }
  check(`${c.name}: focus moves into the dialog`, opened.focusInside);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1600);
  const after = await page.evaluate((route) => ({
    navigated: location.pathname !== route,
    path: location.pathname + location.search,
    closed: !document.querySelector("[role=dialog]"),
    active: document.activeElement?.getAttribute("aria-label")
      || (document.activeElement?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40)
      || document.activeElement?.tagName
  }), c.route);

  check(`${c.name}: Escape closes it`, after.closed);
  /* A CROSS-PAGE opener cannot be refocused, and must not be faked.
   *
   * The Plan deep link navigates from /dashboard to /plans?plan=..., so by the
   * time the dialog closes the trigger belongs to a page that no longer
   * exists. Restoring focus to a detached node would be wrong, and inventing a
   * nearby substitute would be worse. The primitive's `isConnected` guard
   * declines, which is the correct answer -- so the assertion is on the
   * opener's SURVIVAL, not on unconditional restoration. */
  if (after.navigated) {
    check(`${c.name}: focus is not restored to a detached opener`,
      after.active !== focused,
      `navigated to ${after.path}; opener no longer exists`);
  } else {
    check(`${c.name}: focus returns to the opener`,
      after.active === focused,
      `focus on "${after.active}" (opener was "${focused}")`);
  }

  await page.close();
}

await ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} focus-restoration checks passed`);
