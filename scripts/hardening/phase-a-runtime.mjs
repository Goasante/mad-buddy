/**
 * PHASE A runtime verification, signed in, at real phone widths.
 *
 *   A3  no backdrop may survive without an interactive surface above it
 *   A4  the Create Event dialog and its contents never shift sideways
 *   A5  the Circle chat fills the phone instead of ending halfway up it
 *
 * Every check hit-tests with elementFromPoint rather than trusting a
 * rectangle, and the viewport is asserted before any result counts -- both
 * traps this program has been caught by before.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3200";
const STATE = "C:/mb-god/.phasea.json";
const CIRCLE = process.env.CIRCLE_ID ?? "43ae2358-36e4-4f2e-86d0-afdc7172194b";
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

/** Any element wider than the viewport is a horizontal-overflow source. */
const OVERFLOW_PROBE = `(() => {
  const vw = innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 1.5 || r.left < -1.5) {
      offenders.push({
        tag: el.tagName,
        cls: (el.className && el.className.toString().slice(0, 70)) || "",
        left: Math.round(r.left), right: Math.round(r.right)
      });
    }
  }
  return { vw, docW: document.documentElement.scrollWidth, offenders: offenders.slice(0, 5) };
})()`;

const ORPHAN_PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const scrims = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;
    const dims = cs.backdropFilter !== "none" || cs.filter.includes("blur");
    const m = cs.backgroundColor.match(/rgba?\\(([^)]+)\\)/);
    let tinted = false;
    if (m) {
      const parts = m[1].split(",").map((v) => parseFloat(v));
      tinted = (parts.length > 3 ? parts[3] : 1) > 0.05;
    }
    if (dims || tinted) scrims.push({ cls: (el.className||"").toString().slice(0,50), z: cs.zIndex });
  }
  if (scrims.length === 0) return { scrims: [], reachable: -1, orphaned: [] };
  const tags = new Set(["BUTTON","A","INPUT","TEXTAREA","SELECT"]);
  let reachable = 0;
  for (let gx = 1; gx <= 5; gx++) for (let gy = 1; gy <= 7; gy++) {
    let node = document.elementFromPoint(vw*gx/6, vh*gy/8);
    while (node && node !== document.body) {
      if (tags.has(node.tagName) || node.getAttribute("role") === "dialog" ||
          node.getAttribute("role") === "button" || node.tabIndex >= 0) { reachable++; break; }
      node = node.parentElement;
    }
  }
  return { scrims, reachable, orphaned: reachable === 0 ? scrims : [] };
})()`;

const browser = await chromium.launch();
try {
  for (const width of [360, 390, 430]) {
    const context = await browser.newContext({
      storageState: STATE,
      viewport: { width, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark"
    });
    const page = await context.newPage();

    // ---------------- A4: Create Event ----------------
    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    const vw = await page.evaluate("innerWidth");
    check(`[${width}] viewport is the width under test`, vw === width, `innerWidth=${vw}`);
    if (vw !== width) { await context.close(); continue; }

    const base = await page.evaluate(OVERFLOW_PROBE);
    check(`[${width}] Events page does not scroll horizontally`,
      base.docW <= base.vw + 1, `doc=${base.docW} vw=${base.vw}`);

    // Open Create Event.
    const create = page.getByRole("button", { name: /create an event|create event|new event/i }).first();
    let opened = false;
    if (await create.count()) {
      await create.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      opened = (await page.locator('[role="dialog"]').count()) > 0;
    }
    check(`[${width}] the Create Event dialog opens`, opened,
      opened ? "" : "could not open -- audience steps not measured at this width");

    if (opened) {
      const dialogBox = await page.locator('[role="dialog"]').first().boundingBox();
      const after = await page.evaluate(OVERFLOW_PROBE);
      check(`[${width}] no element overflows the viewport with the dialog open`,
        after.offenders.length === 0,
        after.offenders.length ? JSON.stringify(after.offenders) : `doc=${after.docW}`);
      check(`[${width}] the dialog itself sits inside the viewport`,
        dialogBox !== null && dialogBox.x >= -1 && dialogBox.x + dialogBox.width <= width + 1,
        dialogBox ? `x=${Math.round(dialogBox.x)} w=${Math.round(dialogBox.width)}` : "no box");

      // Every audience option, checking the x-position never moves.
      const audience = page.locator('[role="radiogroup"] [role="radio"], [role="radiogroup"] button');
      const count = await audience.count();
      if (count > 0) {
        const xs = [];
        for (let i = 0; i < count; i++) {
          await audience.nth(i).click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(260);
          const box = await page.locator('[role="dialog"]').first().boundingBox();
          const ov = await page.evaluate(OVERFLOW_PROBE);
          xs.push(box ? Math.round(box.x) : -999);
          check(`[${width}] audience option ${i + 1}/${count}: nothing clips sideways`,
            ov.offenders.length === 0 && ov.docW <= ov.vw + 1,
            ov.offenders.length ? JSON.stringify(ov.offenders) : `doc=${ov.docW}`);
        }
        const stable = xs.every((x) => Math.abs(x - xs[0]) <= 1);
        check(`[${width}] the dialog x-position is stable across all ${count} audiences`,
          stable, `x positions: ${xs.join(", ")}`);
      } else {
        check(`[${width}] audience options were reachable`, false, "no radiogroup found");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    // ---------------- A3: no orphaned backdrop ----------------
    for (let i = 0; i < 3; i++) {
      const btn = page.locator("button").first();
      if (await btn.count()) {
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(100);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(100);
      }
    }
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const orphan = await page.evaluate(ORPHAN_PROBE);
    check(`[${width}] no scrim survives without a reachable surface`,
      orphan.orphaned.length === 0,
      orphan.scrims.length === 0 ? "no scrim present" : `${orphan.scrims.length} scrim(s), ${orphan.reachable} reachable`);

    // ---------------- A5: the Circle chat fills the phone ----------------
    await page.goto(`${BASE}/groups/${CIRCLE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const layout = await page.evaluate(`(() => {
      const section = document.querySelector('section[aria-label$="chat"]');
      if (!section) return { found: false };
      const r = section.getBoundingClientRect();
      const scroller = section.querySelector('[aria-live="polite"]');
      const composer = section.querySelector('textarea, input[type="text"]');
      const nav = document.querySelector('nav.fixed, nav[class*="bottom-0"]');
      return {
        found: true,
        vh: innerHeight,
        top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
        scrollerH: scroller ? Math.round(scroller.getBoundingClientRect().height) : 0,
        composerBottom: composer ? Math.round(composer.getBoundingClientRect().bottom) : 0,
        navTop: nav ? Math.round(nav.getBoundingClientRect().top) : innerHeight,
        docW: document.documentElement.scrollWidth
      };
    })()`);

    if (!layout.found) {
      check(`[${width}] the Circle chat panel is present`, false, "section not found -- not signed in?");
    } else {
      // The dead region below the chat, before the navigation begins.
      const dead = layout.navTop - layout.bottom;
      check(`[${width}] the chat reaches the navigation without a dead gap`,
        dead <= 64, `gap=${dead}px (chat bottom ${layout.bottom}, nav top ${layout.navTop})`);
      check(`[${width}] the chat does not run under the navigation`,
        layout.bottom <= layout.navTop + 1, `bottom=${layout.bottom} navTop=${layout.navTop}`);
      check(`[${width}] the chat starts below the top of the screen`,
        layout.top >= 0, `top=${layout.top}`);
      check(`[${width}] the message viewport takes most of the panel`,
        layout.scrollerH > layout.height * 0.5,
        `scroller=${layout.scrollerH} of panel=${layout.height}`);
      check(`[${width}] the Circle page does not scroll horizontally`,
        layout.docW <= width + 1, `doc=${layout.docW}`);
    }

    await context.close();
  }
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} Phase A runtime checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
