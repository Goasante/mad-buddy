/**
 * BETA — application-wide mobile horizontal-overflow detector.
 *
 * Tester screenshots show the SAME defect class on several screens: content
 * clipped at the right edge, "Save profil…", "Lowercase letters, numbers, and
 * undersco…", modal bodies running off. That pattern says one shared primitive,
 * not several unrelated screens, so this looks for the offender rather than
 * patching each surface.
 *
 * THE INVARIANT, at 390px:
 *   document.documentElement.scrollWidth <= window.innerWidth
 *
 * For any element that breaks it, this reports the element AND its ancestor
 * chain, because the culprit is almost never the widest element -- it is
 * whichever ancestor failed to constrain it (a flex/grid child missing
 * `min-width: 0`, an image with intrinsic width, a `w-max` track).
 *
 * Deliberately does NOT suggest `overflow-x: hidden`. That hides the symptom
 * and leaves descendants mis-sized; the point is to find the offender.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const WIDTH = Number(process.env.MB_WIDTH || 390);

const ROUTES = [
  "/dashboard", "/friends", "/messages", "/plans", "/events",
  "/linkr", "/hangout-mode", "/profile", "/profile/edit",
  "/settings", "/settings/access", "/groups", "/moments", "/safe-arrival"
];

const DETECT = () => {
  const vw = window.innerWidth;
  const docWidth = document.documentElement.scrollWidth;
  const offenders = [];

  const describe = (el) => {
    const cls = (el.className || "").toString().replace(/\s+/g, " ").slice(0, 64);
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls.split(" ")[0] : ""}${txt ? ` "${txt}"` : ""}`;
  };

  for (const el of document.querySelectorAll("body *")) {
    /* Decorative layers are positioned outside the box on purpose and clip
       correctly; they are not content escaping. */
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (el.closest("[aria-hidden=true]")) continue;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === "none" || cs.position === "fixed") continue;
    if (cs.visibility === "hidden" || cs.display === "none") continue;

    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;

    /* Inside a deliberate horizontal scroller (a tab strip, a carousel rail)
       is fine -- that is a designed affordance, not a broken layout. */
    let scroller = null;
    let node = el.parentElement;
    while (node && node !== document.body) {
      const st = getComputedStyle(node);
      if (/(auto|scroll)/.test(st.overflowX) && node.scrollWidth > node.clientWidth + 2) { scroller = node; break; }
      node = node.parentElement;
    }
    if (scroller) continue;

    // The ancestor chain, so the constraining failure is visible.
    const chain = [];
    let p = el.parentElement;
    for (let i = 0; i < 5 && p && p !== document.body; i += 1) {
      const ps = getComputedStyle(p);
      chain.push(`${describe(p).slice(0, 40)} [w=${Math.round(p.getBoundingClientRect().width)} minw=${ps.minWidth} ovf=${ps.overflowX}]`);
      p = p.parentElement;
    }

    offenders.push({
      el: describe(el),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      minWidth: cs.minWidth,
      flexShrink: cs.flexShrink,
      whiteSpace: cs.whiteSpace,
      chain
    });
  }

  // Widest first -- most likely to be the root, not a clipped child.
  offenders.sort((a, b) => b.width - a.width);
  return { vw, docWidth, overflows: docWidth > vw + 1, offenders: offenders.slice(0, 4) };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: WIDTH, height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "dark"
});

let bad = 0;
console.log(`${"=".repeat(78)}\nHORIZONTAL OVERFLOW @ ${WIDTH}px\n${"=".repeat(78)}`);

for (const route of ROUTES) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    const r = await page.evaluate(DETECT);
    if (!r.overflows && r.offenders.length === 0) {
      console.log(`ok    ${route}`);
    } else {
      bad += 1;
      console.log(`\nFAIL  ${route}   doc=${r.docWidth} vw=${r.vw}`);
      for (const o of r.offenders) {
        console.log(`        ${o.el}`);
        console.log(`          w=${o.width} left=${o.left} right=${o.right} minWidth=${o.minWidth} shrink=${o.flexShrink} ws=${o.whiteSpace}`);
        for (const c of o.chain) console.log(`          ^ ${c}`);
      }
    }
  } catch (e) {
    console.log(`ERR   ${route}  ${String(e).split("\n")[0].slice(0, 70)}`);
  }
  await page.close();
}

await browser.close();
console.log(`\n${ROUTES.length} routes, ${bad} with horizontal overflow`);
