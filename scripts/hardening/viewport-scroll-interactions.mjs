/**
 * Focus/keyboard, overlay restoration and desktop geometry checks for the
 * canonical app scroll owner. This complements viewport-scroll-contract.mjs:
 * that harness inventories routes; this one exercises stateful surfaces.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.env.MB_PLAYWRIGHT_ROOT || process.cwd(), "package.json"));
const { chromium } = require("playwright");

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || join(process.cwd(), ".artifacts", "auth-local.json");
const OUT = process.env.MB_INTERACTION_OUT || join(process.cwd(), ".artifacts", "viewport-scroll-interactions");
const GROUP_ROUTE = process.env.MB_GROUP_ROUTE || "/groups/43ae2358-36e4-4f2e-86d0-afdc7172194b";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const results = [];

async function settle(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_200);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dismiss = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
    if (!(await dismiss.count())) break;
    await dismiss.click().catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function shellState(page) {
  return page.evaluate(() => {
    const owner = document.querySelector("[data-app-scroll-owner]");
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    return {
      owner: owner instanceof HTMLElement
        ? { scrollTop: owner.scrollTop, scrollHeight: owner.scrollHeight, clientHeight: owner.clientHeight }
        : null,
      documentOverflow: Math.max(
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
        document.body.scrollHeight - innerHeight
      ),
      bodyOverflow: document.body.style.overflow,
      navTop: nav instanceof HTMLElement && nav.getBoundingClientRect().height > 1
        ? nav.getBoundingClientRect().top
        : innerHeight
    };
  });
}

async function focusCheck({ name, route, prepare, locator }) {
  const context = await browser.newContext({
    storageState: AUTH,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const result = { kind: "keyboard", name, route, status: "FAIL", problems: [] };
  try {
    await settle(page, route);
    if (prepare) await prepare(page);
    const field = locator(page).first();
    if (!(await field.count()) || !(await field.isVisible())) {
      throw new Error("focusable field was not visible");
    }
    await field.focus();
    await page.setViewportSize({ width: 390, height: 520 });
    await field.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
    await page.waitForTimeout(180);
    const compact = await field.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const owner = document.querySelector("[data-app-scroll-owner]");
      const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
      const insideModal = Boolean(element.closest('[role="dialog"], [aria-modal="true"]'));
      const navTop = !insideModal && nav instanceof HTMLElement && nav.getBoundingClientRect().height > 1
        ? nav.getBoundingClientRect().top
        : innerHeight;
      return {
        top: rect.top,
        bottom: rect.bottom,
        visibleFloor: navTop,
        hit: hit === element || element.contains(hit) || Boolean(hit && hit.contains(element)),
        focused: document.activeElement === element,
        documentOverflow: Math.max(
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
          document.body.scrollHeight - innerHeight
        ),
        ownerPresent: owner instanceof HTMLElement
      };
    });
    if (!compact.ownerPresent) result.problems.push("canonical scroll owner missing");
    if (!compact.focused) result.problems.push("field lost focus after compact viewport resize");
    if (compact.top < -2 || compact.bottom > compact.visibleFloor + 2) {
      result.problems.push(`focused field outside visible content region (${Math.round(compact.top)}..${Math.round(compact.bottom)}, floor ${Math.round(compact.visibleFloor)})`);
    }
    if (!compact.hit) result.problems.push("focused field is covered at its centre point");
    if (compact.documentOverflow > 2) result.problems.push(`document gained ${Math.round(compact.documentOverflow)}px overflow`);
    await page.screenshot({ path: join(OUT, `${name.replace(/[^a-z0-9]+/gi, "_")}_compact.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    const restored = await shellState(page);
    if (!restored.owner) result.problems.push("scroll owner missing after viewport restore");
    if (restored.documentOverflow > 2) result.problems.push("document overflow remained after viewport restore");
    result.compact = compact;
    result.restored = restored;
    result.status = result.problems.length ? "FAIL" : "PASS";
  } catch (error) {
    result.problems.push(String(error).split("\n")[0]);
  }
  results.push(result);
  await context.close();
}

const clickNamed = (pattern) => async (page) => {
  const control = page.getByRole("button", { name: pattern }).first();
  if (!(await control.count()) || !(await control.isVisible())) throw new Error(`opener ${pattern} was not visible`);
  await control.click();
  await page.waitForTimeout(300);
};

await focusCheck({
  name: "friends-search",
  route: "/friends",
  locator: (page) => page.locator('input[type="search"], input[placeholder*="Search" i]')
});
await focusCheck({
  name: "group-composer",
  route: GROUP_ROUTE,
  locator: (page) => page.locator("textarea, input[placeholder*='message' i]")
});
await focusCheck({
  name: "profile-edit",
  route: "/profile",
  prepare: clickNamed(/edit profile/i),
  locator: (page) => page.locator('input[name="fullName"], input[name="full_name"], input').filter({ visible: true })
});
await focusCheck({
  name: "plan-create",
  route: "/plans",
  prepare: clickNamed(/create|new plan|make a plan/i),
  locator: (page) => page.locator("input, textarea")
});
await focusCheck({
  name: "event-create",
  route: "/events",
  prepare: async (page) => {
    await clickNamed(/^create$/i)(page);
    await clickNamed(/^continue$/i)(page);
  },
  locator: (page) => page.locator("#event-name")
});
await focusCheck({
  name: "upfor-create",
  route: "/hangout-mode",
  prepare: clickNamed(/start an upfor|create|new upfor/i),
  locator: (page) => page.locator("input, textarea")
});
await focusCheck({
  name: "support-feedback",
  route: "/settings/feedback",
  locator: (page) => page.locator("textarea, input")
});

async function overlayCheck(name, route, opener) {
  const context = await browser.newContext({ storageState: AUTH, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const result = { kind: "overlay", name, route, status: "FAIL", problems: [] };
  try {
    await settle(page, route);
    const owner = page.locator("[data-app-scroll-owner]");
    await owner.evaluate((element) => { element.scrollTop = Math.min(80, element.scrollHeight - element.clientHeight); });
    const before = await shellState(page);
    const control = opener(page).first();
    if (!(await control.count()) || !(await control.isVisible())) throw new Error("overlay opener was not visible");
    await control.click();
    await page.waitForTimeout(300);
    const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
    if (!(await dialog.count()) || !(await dialog.isVisible())) throw new Error("dialog/sheet did not open");
    const open = await shellState(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    const after = await shellState(page);
    if (await dialog.isVisible().catch(() => false)) result.problems.push("dialog remained visible after Escape");
    if (after.bodyOverflow !== before.bodyOverflow) result.problems.push(`body overflow did not restore (${before.bodyOverflow} -> ${after.bodyOverflow})`);
    if (Math.abs((after.owner?.scrollTop ?? 0) - (before.owner?.scrollTop ?? 0)) > 2) result.problems.push("page scroll position changed after overlay close");
    if (after.documentOverflow > 2) result.problems.push("document overflow remained after overlay close");
    result.before = before;
    result.open = open;
    result.after = after;
    result.status = result.problems.length ? "FAIL" : "PASS";
  } catch (error) {
    result.problems.push(String(error).split("\n")[0]);
  }
  results.push(result);
  await context.close();
}

await overlayCheck("plan-create-sheet", "/plans", (page) => page.getByRole("button", { name: /create|new plan|make a plan/i }));
await overlayCheck("app-menu-sheet", "/dashboard", (page) => page.getByRole("button", { name: /menu|settings/i }));

for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  const context = await browser.newContext({ storageState: AUTH, viewport });
  for (const route of ["/dashboard", "/linkr", "/messages", "/settings", GROUP_ROUTE]) {
    const page = await context.newPage();
    const result = { kind: "desktop", name: `${viewport.width}x${viewport.height} ${route}`, route, status: "FAIL", problems: [] };
    try {
      await settle(page, route);
      const state = await page.evaluate(() => {
        const owner = document.querySelector("[data-app-scroll-owner]");
        const sidebar = document.querySelector("aside, nav[aria-label*='Desktop' i]");
        return {
          ownerPresent: owner instanceof HTMLElement,
          ownerClientHeight: owner instanceof HTMLElement ? owner.clientHeight : 0,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          sidebarVisible: sidebar instanceof HTMLElement && sidebar.getBoundingClientRect().width > 1
        };
      });
      if (!state.ownerPresent) result.problems.push("canonical scroll owner missing");
      if (state.ownerClientHeight < viewport.height * 0.7) result.problems.push("desktop content region was compressed");
      if (state.horizontalOverflow > 2) result.problems.push(`desktop gained ${Math.round(state.horizontalOverflow)}px horizontal overflow`);
      if (state.documentOverflow > 2) result.problems.push(`desktop document gained ${Math.round(state.documentOverflow)}px vertical overflow`);
      result.state = state;
      result.status = result.problems.length ? "FAIL" : "PASS";
    } catch (error) {
      result.problems.push(String(error).split("\n")[0]);
    }
    results.push(result);
    await page.close();
  }
  await context.close();
}

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
for (const result of results) {
  console.log(`${result.status.padEnd(4)} ${result.kind.padEnd(8)} ${result.name}`);
  for (const problem of result.problems) console.log(`     - ${problem}`);
}
const failures = results.filter((result) => result.status !== "PASS");
console.log(`\n${results.length - failures.length}/${results.length} interaction/desktop checks passed`);
if (failures.length) process.exitCode = 1;
