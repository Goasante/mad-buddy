/**
 * BATCH 3 — reproduce all five defects before editing anything.
 *
 * BETA-003 Events opens blurred with no usable foreground
 * BETA-005 Create Event modal overflows / floats
 * BETA-010 duplicate search fields on Muddies and Messages
 * BETA-014 scroll area runs into the bottom navigation
 * BETA-016 Circle/group surface moves on touch
 *
 * The point is a CAUSE MAP, not five patches: several of these may resolve to
 * one shell or overlay primitive, and that is only visible with all five
 * measured side by side.
 *
 * VIEWPORT IS ASSERTED, NOT ASSUMED. Earlier harnesses in this program passed
 * while every viewport silently measured 980px. Each check confirms
 * `window.innerWidth` matches what was requested before its result counts.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-photos.json";
const W = 390;
const H = 844;

const results = [];
const check = (n, ok, d) => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

/** Refuses to report unless the browser really applied the viewport. */
async function assertViewport(page, label) {
  const v = await page.evaluate(() => ({
    inner: window.innerWidth,
    visual: window.visualViewport ? Math.round(window.visualViewport.width) : null
  }));
  const ok = v.inner === W && (v.visual === null || Math.abs(v.visual - W) <= 1);
  if (!ok) check(`${label}: viewport actually applied`, false, `innerWidth=${v.inner} visual=${v.visual}`);
  return ok;
}

const overflow = () =>
  ({
    doc: document.documentElement.scrollWidth,
    vw: window.innerWidth,
    offenders: (() => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden=true]")) continue;
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.pointerEvents === "none") continue;
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.right <= window.innerWidth + 1 && r.left >= -1) continue;
        let node = el.parentElement, scroller = false;
        while (node && node !== document.body) {
          const st = getComputedStyle(node);
          if (/(auto|scroll)/.test(st.overflowX) && node.scrollWidth > node.clientWidth + 2) { scroller = true; break; }
          node = node.parentElement;
        }
        if (scroller) continue;
        const cls = (el.className || "").toString().replace(/\s+/g, " ").slice(0, 60);
        out.push(`${el.tagName.toLowerCase()}${cls ? "." + cls.split(" ")[0] : ""} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
      }
      return [...new Set(out)].slice(0, 3);
    })()
  });

/** A backdrop with no usable foreground is the BETA-003 signature. */
const overlayState = () => {
  const backdrops = [...document.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.8 || r.height < window.innerHeight * 0.5) return false;
    const blurred = /blur/.test(cs.backdropFilter || "") || /blur/.test(cs.filter || "");
    const dimmed = cs.backgroundColor && !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    return blurred || dimmed;
  });
  const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, [data-state="open"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 40 && getComputedStyle(el).visibility !== "hidden";
    });
  return {
    backdrops: backdrops.length,
    dialogs: dialogs.length,
    bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
    bodyOverflow: getComputedStyle(document.body).overflow,
    strandedBackdrop: backdrops.length > 0 && dialogs.length === 0
  };
};

/** Search inputs the user can actually see and type into. */
const visibleSearches = () =>
  [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 10) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      const ph = (el.getAttribute("placeholder") || "").toLowerCase();
      const al = (el.getAttribute("aria-label") || "").toLowerCase();
      return /search|find/.test(ph + " " + al);
    })
    .map((el) => ({
      ph: el.getAttribute("placeholder") || el.getAttribute("aria-label") || "",
      top: Math.round(el.getBoundingClientRect().top)
    }));

/** Does anything interactive sit under the fixed bottom nav? */
const navOverlap = () => {
  const nav = [...document.querySelectorAll("nav, [role=navigation]")]
    .map((n) => ({ n, r: n.getBoundingClientRect(), cs: getComputedStyle(n) }))
    .find((x) => x.cs.position === "fixed" && x.r.bottom >= window.innerHeight - 4 && x.r.height > 20);
  if (!nav) return { hasNav: false };

  // Scroll to the very bottom: that is where content collides with the nav.
  window.scrollTo(0, document.documentElement.scrollHeight);
  const hidden = [];
  for (const el of document.querySelectorAll("button, a[href], input, textarea, [role=button]")) {
    /* The nav's OWN links sit inside the nav band by definition. Counting them
       reported "Messages, Muddies, Home, Linkr" as hidden controls on every
       route -- a probe measuring the thing it was meant to measure against. */
    if (nav.n.contains(el)) continue;
    if (el.closest("nav, [role=navigation], header")) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;

    /* CLIPPED IS NOT HIDDEN.
     *
     * `getBoundingClientRect()` reports a rectangle for a child even when an
     * ancestor clips it away -- the collapsed quick-actions list is
     * `max-height: 0; overflow: hidden`, and its items still measure as real
     * boxes sitting inside the nav band. Reading only the rectangle produced a
     * confident false positive: "a Quick Action is unreachable behind the nav"
     * when the menu was simply shut.
     *
     * The honest question is whether the user can actually reach it, so ask
     * the document: if the point belongs to something else, the control is not
     * exposed there. */
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) continue;
    const atPoint = document.elementFromPoint(cx, cy);
    if (!atPoint || !(el === atPoint || el.contains(atPoint))) continue;

    if (cy > nav.r.top + 2 && cy < nav.r.bottom) {
      const t = (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 28);
      hidden.push(t || el.tagName.toLowerCase());
    }
  }
  return {
    hasNav: true,
    navTop: Math.round(nav.r.top),
    navHeight: Math.round(nav.r.height),
    hiddenControls: [...new Set(hidden)].slice(0, 4),
    docHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: W, height: H },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "dark"
});

console.log(`${"=".repeat(76)}\nBATCH 3 REPRODUCTION @ ${W}x${H} dark\n${"=".repeat(76)}`);

// ---- BETA-003 + BETA-005: Events ----------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  if (await assertViewport(page, "events")) {
    const o = await page.evaluate(overflow);
    check("BETA-003 /events: no horizontal overflow", o.doc <= o.vw + 1, `doc=${o.doc} vw=${o.vw} ${o.offenders.join(" | ")}`);

    const st = await page.evaluate(overlayState);
    check("BETA-003 /events: no stranded backdrop on load",
      !st.strandedBackdrop, `backdrops=${st.backdrops} dialogs=${st.dialogs} bodyPE=${st.bodyPointerEvents}`);

    // open → close → reopen, the reported sequence
    for (let i = 0; i < 2; i += 1) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((e) => /create/i.test(e.textContent || ""));
        if (b) b.click();
      });
      await page.waitForTimeout(2200);
      const open = await page.evaluate(overlayState);
      check(`BETA-005 Create Event open (pass ${i + 1}): dialog present with its backdrop`,
        !open.strandedBackdrop, `backdrops=${open.backdrops} dialogs=${open.dialogs}`);

      const mo = await page.evaluate(overflow);
      check(`BETA-005 Create Event open (pass ${i + 1}): no horizontal overflow`,
        mo.doc <= mo.vw + 1, `doc=${mo.doc} vw=${mo.vw} ${mo.offenders.join(" | ")}`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      const closed = await page.evaluate(overlayState);
      check(`BETA-003 after close (pass ${i + 1}): no stranded backdrop`,
        !closed.strandedBackdrop, `backdrops=${closed.backdrops} dialogs=${closed.dialogs} bodyPE=${closed.bodyPointerEvents}`);
      check(`BETA-003 after close (pass ${i + 1}): body is interactive`,
        closed.bodyPointerEvents !== "none", `pointer-events=${closed.bodyPointerEvents}`);
    }

    // browser back after opening
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((e) => /create/i.test(e.textContent || ""));
      if (b) b.click();
    });
    await page.waitForTimeout(2000);
    await page.goBack({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const afterBack = await page.evaluate(overlayState);
    check("BETA-003 after browser back: no stranded backdrop",
      !afterBack.strandedBackdrop, `backdrops=${afterBack.backdrops} dialogs=${afterBack.dialogs}`);
  }
  await page.close();
}

// ---- BETA-010: duplicate searches ----------------------------------------
for (const [route, label] of [["/friends", "Muddies"], ["/messages", "Messages"]]) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2800);
  if (await assertViewport(page, label)) {
    const s = await page.evaluate(visibleSearches);
    check(`BETA-010 ${label}: exactly one visible search field`,
      s.length <= 1, `${s.length} found: ${s.map((x) => `"${x.ph}"@${x.top}`).join(", ")}`);
  }
  await page.close();
}

// ---- BETA-014: bottom nav overlap ----------------------------------------
for (const [route, label] of [["/friends", "Muddies"], ["/messages", "Messages"], ["/events", "Events"]]) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2800);
  if (await assertViewport(page, label)) {
    const n = await page.evaluate(navOverlap);
    if (!n.hasNav) { check(`BETA-014 ${label}: fixed bottom nav present`, false, "no fixed nav found"); }
    else {
      check(`BETA-014 ${label}: no control hidden behind the bottom nav`,
        n.hiddenControls.length === 0,
        n.hiddenControls.length ? n.hiddenControls.join(", ") : `navTop=${n.navTop} h=${n.navHeight}`);
    }
  }
  await page.close();
}

// ---- BETA-016: touch stability -------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/groups`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  if (await assertViewport(page, "groups")) {
    const shift = await page.evaluate(async () => {
      const target = [...document.querySelectorAll("a[href^='/groups/'], button")].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 80 && r.height > 30 && r.top > 60 && r.bottom < window.innerHeight - 100;
      });
      if (!target) return { found: false };

      const sample = () => [...document.querySelectorAll("main *")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 20; })
        .slice(0, 40)
        .map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)}`; });

      const before = sample();
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 180));
      const during = sample();
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 180));
      const after = sample();

      const moved = (a, b) => a.filter((v, i) => b[i] !== undefined && v !== b[i]).length;
      return { found: true, movedDuring: moved(before, during), movedAfter: moved(before, after), sampled: before.length };
    });
    if (!shift.found) check("BETA-016 groups: a tappable card was found", false, "none matched");
    else {
      check("BETA-016 groups: pressing a card moves nothing else",
        shift.movedDuring === 0 && shift.movedAfter === 0,
        `moved during=${shift.movedDuring} after=${shift.movedAfter} of ${shift.sampled} elements`);
    }
  }
  await page.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} reproduction checks passed`);
console.log(`FAILING (these are the defects to fix):`);
for (const r of results.filter((x) => !x.ok)) console.log(`   ${r.n}`);
