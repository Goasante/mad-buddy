/**
 * Mission 2 Extreme — the carried open question: message action geometry.
 *
 * Advanced measured React/Edit/Delete at roughly 17px tall and could not
 * establish whether they sit inside a menu, which would make that size
 * acceptable. Source reading now shows BOTH paths exist: a LongPressActions
 * menu wrapping the bubble, and an inline row of text buttons beneath it.
 *
 * The question a screenshot cannot answer is what a FINGER gets. The inline row
 * is `opacity-0 group-hover:opacity-100`. Hover is a pointer capability; a
 * touch device has none. So this runs the same page twice:
 *
 *   - a real touch context (hasTouch, isMobile, no hover)
 *   - a real mouse context (hover available)
 *
 * and reports, for each, whether the actions are reachable and how big they
 * actually are. Measuring the bounding box alone would repeat the Advanced
 * mistake; opacity and pointer-events decide whether a box can be TAPPED.
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

/** Reports what the inline action row is, geometrically and practically. */
const PROBE = () => {
  const out = { bubbles: 0, rows: [] };
  // The action row is the flex row holding the text buttons under a bubble.
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter((b) => ["React", "Edit", "Delete"].includes((b.innerText || "").trim()));
  out.bubbles = document.querySelectorAll("[class*='rounded-[1.25rem]']").length;

  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    const st = getComputedStyle(b);
    // Opacity is inherited from the wrapping row, so walk up for the real one.
    let effOpacity = 1, el = b;
    while (el && el !== document.body) {
      effOpacity *= Number(getComputedStyle(el).opacity);
      el = el.parentElement;
    }
    out.rows.push({
      label: (b.innerText || "").trim(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      effOpacity: +effOpacity.toFixed(3),
      pointerEvents: st.pointerEvents,
      // What a tap at the centre of this control would actually hit.
      hitsSelf: (() => {
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(t && (t === b || b.contains(t)));
      })()
    });
  }
  return out;
};

const browser = await chromium.launch();

async function run(label, contextOpts) {
  const ctx = await browser.newContext({ storageState: AUTH, ...contextOpts });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/messages?conversation=${CONVO}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  // Without interacting at all: what does a user SEE?
  const resting = await page.evaluate(PROBE);

  // Now hover the first bubble, the way a mouse user would.
  let hovered = null;
  const bubble = page.locator("[class*='rounded-\[1\.25rem\]']").first();
  if (await bubble.count()) {
    await bubble.hover({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    hovered = await page.evaluate(PROBE);
  }

  await ctx.close();
  return { label, resting, hovered };
}

const touch = await run("touch (phone)", {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true
});
const mouse = await run("mouse (desktop)", {
  viewport: { width: 1280, height: 900 }, hasTouch: false
});

console.log(`\n${"=".repeat(72)}\nMESSAGE ACTION GEOMETRY\n${"=".repeat(72)}`);
for (const r of [touch, mouse]) {
  console.log(`\n${r.label}`);
  console.log(`  bubbles rendered      : ${r.resting.bubbles}`);
  const fmt = (s) => s.rows.length
    ? s.rows.map((x) => `${x.label} ${x.w}x${x.h} op=${x.effOpacity} pe=${x.pointerEvents} hit=${x.hitsSelf}`).join("\n        ")
    : "(none in DOM)";
  console.log(`  at rest : ${fmt(r.resting)}`);
  console.log(`  hovered : ${r.hovered ? fmt(r.hovered) : "(no bubble to hover)"}`);
}

// The probe must have had something to measure, or every verdict below is
// vacuous — the empty-fixture trap this program has already been caught by.
check("the conversation actually rendered messages to act on",
  touch.resting.bubbles > 0 && touch.resting.rows.length > 0,
  `${touch.resting.bubbles} bubbles, ${touch.resting.rows.length} action buttons in DOM`);

const restingVisible = touch.resting.rows.filter((r) => r.effOpacity > 0.01);
check("on touch, the inline actions are VISIBLE at rest (not hover-gated)",
  restingVisible.length > 0,
  restingVisible.length ? `${restingVisible.length} visible` : "all at opacity 0 — invisible until a hover that a finger cannot produce");

const tappable = touch.resting.rows.filter((r) => r.h >= 44);
check("on touch, the inline actions meet the 44px minimum",
  touch.resting.rows.length === 0 || tappable.length === touch.resting.rows.length,
  `${tappable.length}/${touch.resting.rows.length} at >=44px; heights ${[...new Set(touch.resting.rows.map((r) => r.h))].join(",")}`);

const mouseHoverVisible = (mouse.hovered?.rows ?? []).filter((r) => r.effOpacity > 0.01);
check("on mouse, hovering a bubble reveals the actions",
  mouseHoverVisible.length > 0,
  `${mouseHoverVisible.length} visible after hover`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} geometry checks passed`);
