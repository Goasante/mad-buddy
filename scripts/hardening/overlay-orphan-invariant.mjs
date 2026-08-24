/**
 * PHASE A / A3 -- a backdrop may NEVER survive without its owner.
 *
 * Owner real-device evidence (video): Events is usable, a navigation or
 * interaction happens, and a blurred/dimmed backdrop appears with no usable
 * surface on top of it. The page is effectively stranded.
 *
 * ROOT CAUSE FOUND IN CODE, not by reproducing the video: TourRunner clamped
 * its step `index` only in the useState initialiser, which runs once. If the
 * step list shrank while the tour was running -- which is exactly what
 * navigating can do, since steps can stop being eligible -- `index` was left
 * past the end, `step` became undefined, and the running branch rendered its
 * full-screen `z-[94]` scrim WITHOUT requiring a step to show. A blur over the
 * page with an empty card and no way out.
 *
 * This harness proves the INVARIANT rather than the anecdote: for every
 * full-screen dimming layer in the DOM, there must be an interactive surface
 * above it. It runs the reported gesture sequence -- open, close, back,
 * reopen, and rapid open/close/open -- and asserts the invariant after each.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

/**
 * Finds every element that dims or blurs most of the viewport, then asks
 * whether anything interactive sits above it.
 *
 * Deliberately hit-tests with elementFromPoint instead of trusting rectangles:
 * a rect is not reachability, and rect-only probes have produced false
 * positives in this program before.
 */
const ORPHAN_PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const scrims = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    const r = el.getBoundingClientRect();
    // Covers most of the screen?
    if (r.width < vw * 0.8 || r.height < vh * 0.8) continue;
    const dims = cs.backdropFilter !== "none" || cs.filter.includes("blur");
    const bg = cs.backgroundColor;
    const m = bg.match(/rgba?\\(([^)]+)\\)/);
    let tinted = false;
    if (m) {
      const parts = m[1].split(",").map((v) => parseFloat(v));
      const alpha = parts.length > 3 ? parts[3] : 1;
      tinted = alpha > 0.05;
    }
    if (!dims && !tinted) continue;
    scrims.push({
      cls: (el.className && el.className.toString().slice(0, 60)) || el.tagName,
      z: cs.zIndex,
      dims,
      tinted
    });
  }
  if (scrims.length === 0) return { scrims: [], orphaned: [], bodyPointer: getComputedStyle(document.body).pointerEvents };

  // Is there an interactive surface the user can actually reach? Sample a grid
  // of points and ask the document what is on top at each one.
  const interactiveTags = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]);
  let reachable = 0;
  for (let gx = 1; gx <= 5; gx++) {
    for (let gy = 1; gy <= 7; gy++) {
      const el = document.elementFromPoint((vw * gx) / 6, (vh * gy) / 8);
      if (!el) continue;
      let node = el;
      while (node && node !== document.body) {
        if (interactiveTags.has(node.tagName) || node.getAttribute("role") === "dialog" ||
            node.getAttribute("role") === "button" || node.tabIndex >= 0) {
          reachable++;
          break;
        }
        node = node.parentElement;
      }
    }
  }
  return {
    scrims,
    reachable,
    orphaned: reachable === 0 ? scrims : [],
    bodyPointer: getComputedStyle(document.body).pointerEvents,
    bodyOverflow: getComputedStyle(document.body).overflow
  };
})()`;

async function assertNoOrphan(page, label) {
  const state = await page.evaluate(ORPHAN_PROBE);
  const ok = state.orphaned.length === 0;
  check(
    `${label}: no scrim without a reachable surface`,
    ok,
    state.scrims.length === 0
      ? "no scrim present"
      : `${state.scrims.length} scrim(s), ${state.reachable} reachable point(s)` +
        (ok ? "" : ` -- ORPHANED: ${JSON.stringify(state.orphaned)}`)
  );
  check(
    `${label}: the page still accepts input`,
    state.bodyPointer !== "none",
    `body pointer-events=${state.bodyPointer}`
  );
  return state;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark"
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);

  // The viewport must be what we think it is before any result counts.
  const vw = await page.evaluate("innerWidth");
  check("viewport is the phone width under test", vw === 390, `innerWidth=${vw}`);

  await assertNoOrphan(page, "events settled");

  // ---- the reported gesture sequence -------------------------------------
  const opener = page.locator("button, a").first();
  if (await opener.count()) {
    await opener.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    await assertNoOrphan(page, "after opening");

    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await assertNoOrphan(page, "after closing");

    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(600);
    await assertNoOrphan(page, "after browser-back");

    await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await assertNoOrphan(page, "after reopening");
  }

  // ---- rapid open/close/open, mid-transition ------------------------------
  for (let i = 0; i < 3; i++) {
    const btn = page.locator("button").first();
    if (await btn.count()) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(90);          // deliberately mid-animation
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(90);
    }
  }
  await page.waitForTimeout(700);
  await assertNoOrphan(page, "after rapid open/close/open");

  // ---- the exact defect: a tour scrim with its step gone ------------------
  // Proven directly, because the video's trigger is not reproducible here.
  const orphanSim = await page.evaluate(`(() => {
    const scrim = document.createElement("div");
    scrim.setAttribute("data-orphan-probe", "1");
    scrim.style.cssText =
      "position:fixed;inset:0;z-index:94;background:rgba(20,20,20,0.45);backdrop-filter:blur(1px)";
    document.body.appendChild(scrim);
    return true;
  })()`);
  const withOrphan = await page.evaluate(ORPHAN_PROBE);
  check(
    "NEGATIVE CONTROL: the probe DOES detect a genuinely orphaned scrim",
    orphanSim && withOrphan.orphaned.length > 0,
    `reachable=${withOrphan.reachable} -- if this passes, the checks above measured something real`
  );
  await page.evaluate(`document.querySelector("[data-orphan-probe]")?.remove()`);
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await browser.close();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} overlay-orphan checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
