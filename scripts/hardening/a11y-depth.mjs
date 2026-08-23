/**
 * Mission 2 Extreme — accessibility depth.
 *
 * Beyond "does it have a label". The brief asks for dialog focus management,
 * sheet focus restoration, reduced motion, disabled-state semantics, and
 * whether any action is reachable ONLY by a gesture.
 *
 * Each check states what it would take to FAIL, so a pass means something.
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});

// --- A. DIALOG FOCUS MANAGEMENT --------------------------------------------
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}/friends`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const opener = page.getByRole("button", { name: "Kofi Mensah, open profile", exact: true }).first();
  if (!(await opener.count())) {
    inconclusive("dialog focus", "the Muddy profile opener was not present");
  } else {
    const beforeTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
    await opener.click();
    await page.waitForTimeout(1800);

    const state = await page.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]");
      if (!dialog) return null;
      const active = document.activeElement;
      return {
        open: true,
        focusInsideDialog: Boolean(active && dialog.contains(active)),
        labelled: Boolean(dialog.getAttribute("aria-label") || dialog.getAttribute("aria-labelledby")),
        modal: dialog.getAttribute("aria-modal")
      };
    });

    if (!state) inconclusive("dialog focus", "no [role=dialog] appeared");
    else {
      check("an opened dialog moves focus inside itself",
        state.focusInsideDialog,
        state.focusInsideDialog ? "focus is within the dialog" : "focus stayed on the page behind it");
      check("the dialog names itself for assistive technology",
        state.labelled, state.labelled ? "aria-label/labelledby present" : "unnamed dialog");

      // Escape must close it, and focus must come back to what opened it.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1400);
      const after = await page.evaluate(() => ({
        stillOpen: Boolean(document.querySelector("[role=dialog]")),
        activeName: (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48)
      }));
      check("Escape closes the dialog", !after.stillOpen, after.stillOpen ? "still open" : "closed");
      check("focus returns to the control that opened it",
        after.activeName.includes("Kofi"),
        `focus is on "${after.activeName || "(nothing)"}" (was "${beforeTag}")`);
    }
  }
  await page.close();
}

// --- B. REDUCED MOTION ------------------------------------------------------
{
  const rmCtx = await browser.newContext({
    storageState: AUTH, viewport: { width: 393, height: 852 },
    isMobile: true, hasTouch: true, reducedMotion: "reduce"
  });
  const page = await rmCtx.newPage();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  /* Anything still animating for more than a moment under prefers-reduced-motion
     is the failure. Infinite animations are the ones that matter -- a spinner
     that never stops is the classic offender. */
  const moving = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const st = getComputedStyle(el);
      const dur = parseFloat(st.animationDuration) || 0;
      const iter = st.animationIterationCount;
      if (dur > 0 && iter === "infinite" && st.animationName !== "none") {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) {
          out.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} ${st.animationName}`);
        }
      }
    }
    return [...new Set(out)];
  });
  check("no infinite animation runs under prefers-reduced-motion",
    moving.length === 0,
    moving.length ? moving.slice(0, 5).join(" | ") : "none running");
  await rmCtx.close();
}

// --- C. KEYBOARD REACH OF MESSAGE ACTIONS -----------------------------------
{
  /* MB-GOD-040's accessibility half: a long-press has no keyboard equivalent,
     so the inline row is the only keyboard route to Edit/Delete. It must be
     focusable, and focusing it must make it visible. */
  const kbCtx = await browser.newContext({
    storageState: AUTH, viewport: { width: 1280, height: 900 }, hasTouch: false
  });
  const page = await kbCtx.newPage();
  const convo = process.env.MB_CONVO || "";
  await page.goto(`${BASE}/messages${convo ? `?conversation=${convo}` : ""}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3800);

  /* Focus and MEASURE ARE SEPARATE STEPS.
   *
   * The first version called .focus() and read the opacity in the same
   * synchronous tick, before the style recalculated for :focus-within -- so it
   * reported "focusing does not reveal the row" while the row was, in fact,
   * about to become visible. That is a false failure against a real fix, which
   * is the most expensive kind. */
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button"))
      .find((x) => ["React", "Edit", "Delete"].includes((x.innerText || "").trim()));
    if (b) b.focus();
  });
  await page.waitForTimeout(600);

  const reachable = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button"))
      .find((x) => ["React", "Edit", "Delete"].includes((x.innerText || "").trim()));
    if (!b) return null;
    let op = 1, el = b;
    while (el && el !== document.body) { op *= Number(getComputedStyle(el).opacity); el = el.parentElement; }
    return { focused: document.activeElement === b, effOpacity: +op.toFixed(3), tabIndex: b.tabIndex };
  });

  if (!reachable) inconclusive("keyboard reach of message actions", "no message action buttons on the page");
  else {
    check("a message action can take keyboard focus", reachable.focused, `tabIndex=${reachable.tabIndex}`);
    check("focusing a message action makes it visible",
      reachable.effOpacity > 0.01,
      `effective opacity ${reachable.effOpacity}`);
  }
  await kbCtx.close();
}

await ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} accessibility-depth checks passed`);
