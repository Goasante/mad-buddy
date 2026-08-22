/**
 * Safe-area / notch audit.
 *
 * The brief records that unsafe-area defects have recurred screen by screen, and
 * asks for the ROOT CAUSE rather than another per-screen patch.
 *
 * IMPORTANT, learned the hard way: `env(safe-area-inset-*)` resolves to **0** in
 * headless Chromium and CANNOT be overridden from script or a stylesheet -- it
 * is a user-agent value, not a custom property. A first version of this script
 * defined `--safe-top`/`--safe-bottom`, painted red markers at 59/34px, and then
 * reported every fixed header and every bottom-nav tab as an intrusion. Those
 * were ALL false positives: the app resolved `env()` to 0 while the markers drew
 * at 59/34, so the two disagreed by construction. Simulating a notch that way
 * measures the simulation, not the app.
 *
 * So this audits the thing that actually decides correctness on a real notched
 * device: whether each surface's geometry is DERIVED from the insets. A header
 * sized `calc(env(safe-area-inset-top) + <content>)` is correct at every inset
 * value, including the 0 a desktop browser reports; a header sized `44px` is
 * wrong on every device whose inset is not 44px, and no amount of screenshotting
 * at inset 0 will reveal it.
 *
 * Checks per route:
 *   - the resolved geometry tokens (proving the formula reached the page)
 *   - every fixed/sticky element, and whether its offset traces back to a token
 *     or is a hard-coded pixel guess
 *   - that page content begins below the fixed header rather than under it
 *   - that the scroll container reserves room for the bottom bar
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/safe-area";
mkdirSync(OUT, { recursive: true });

const routes = (process.argv[2] ||
  "/dashboard,/friends,/profile,/messages,/notifications,/plans,/events,/linkr,/hangout-mode,/settings,/safe-arrival,/groups"
).split(",");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  storageState: AUTH
});

const report = [];

for (const route of routes) {
  const page = await context.newPage();
  const row = { route };
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1800);

    Object.assign(row, await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const token = (name) => rootStyle.getPropertyValue(name).trim() || null;

      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden";
      };

      /* A fixed/sticky element is SAFE when its own top offset, its padding, or
         its height is expressed in terms of the safe-area tokens. Because the
         computed style has already resolved those to pixels, the check reads the
         AUTHORED value out of the stylesheet rules that match the element. */
      const derivesFromInsets = (el) => {
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          if (!rules) continue;
          for (const rule of rules) {
            if (!rule.selectorText || !rule.style) continue;
            let matches = false;
            try { matches = el.matches(rule.selectorText); } catch { continue; }
            if (!matches) continue;
            const text = rule.style.cssText || "";
            if (/safe-area-inset|--app-header-height|--mobile-header-height|--mobile-nav-height/.test(text)) {
              return true;
            }
          }
        }
        // Inline styles and utility classes that reference the tokens directly.
        return /safe-area-inset|--app-header-height|--mobile-header-height/.test(el.getAttribute("style") || "");
      };

      const pinned = [];
      for (const el of document.querySelectorAll("header, nav, [class*=fixed], [class*=sticky]")) {
        const pos = getComputedStyle(el).position;
        if (pos !== "fixed" && pos !== "sticky") continue;
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        // Only elements pinned to an EDGE can collide with an inset.
        const atTop = r.top <= 1;
        const atBottom = Math.abs(r.bottom - window.innerHeight) <= 1;
        if (!atTop && !atBottom) continue;
        /* Full-bleed background layers (a wallpaper, an ambient gradient) are
           EXEMPT: they are supposed to span the inset, and flagging them buries
           the real signal. */
        const isBackdrop =
          /wallpaper|ambient|backdrop|bg-layer/i.test(String(el.className)) ||
          (r.height >= window.innerHeight - 2 && r.width >= window.innerWidth - 2);
        if (isBackdrop) continue;
        pinned.push({
          edge: atTop ? "top" : "bottom",
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 60),
          height: Math.round(r.height),
          safe: derivesFromInsets(el)
        });
      }

      /* Content clearance is measured as <main>'s PADDING, not its top edge.
         <main> deliberately starts at y=0 and reserves room for the fixed
         header with padding-top, so content scrolls beneath a translucent
         header while still BEGINNING below it. An earlier version of this
         audit compared main's top edge against the header height and flagged
         all twelve surfaces; it was measuring the wrong property. Verified:
         padding-top 68px against a 69px header, padding-bottom 100-160px
         against a 75px bottom bar. */
      /* Some surfaces are "immersive": they are listed in IMMERSIVE_HEADER_PAGES,
         so the shell deliberately adds no header offset and the PAGE clears the
         header itself (e.g. `.upfor-page` uses
         `calc(env(safe-area-inset-top) + 4.75rem)`). Looking only at <main>
         reports those as content-under-header, which is wrong -- so the
         measurement falls through to the first child that actually reserves the
         space. */
      const main = document.querySelector("main, #app-main-content, [role=main]");
      let offsetHost = main;
      if (main && Math.round(parseFloat(getComputedStyle(main).paddingTop)) === 0) {
        /* Descend to whichever element actually reserves the space. Matching on
           padding alone is not enough -- on /hangout-mode the padded element is
           `.upfor-page`, which CONTAINS the fixed header as its own first child,
           so a naive "first child's top" reading returns 0 and looks like a
           collision. Verified directly: header bottom 76px, first content
           section top 76px. Content clears the header exactly. */
        for (const candidate of main.querySelectorAll(":scope > *, :scope > * > *")) {
          const pad = Math.round(parseFloat(getComputedStyle(candidate).paddingTop));
          if (pad >= 40) { offsetHost = candidate; break; }
        }
      }
      const mainStyle = offsetHost ? getComputedStyle(offsetHost) : null;
      const mainPadTop = mainStyle ? Math.round(parseFloat(mainStyle.paddingTop)) : null;
      const mainPadBottom = mainStyle ? Math.round(parseFloat(mainStyle.paddingBottom)) : null;

      const topHeights = pinned.filter((p) => p.edge === "top").map((p) => p.height);
      const bottomHeights = pinned.filter((p) => p.edge === "bottom").map((p) => p.height);
      const topPinnedHeight = topHeights.length ? Math.max(...topHeights) : 0;
      const bottomPinnedHeight = bottomHeights.length ? Math.max(...bottomHeights) : 0;

      return {
        appHeaderHeight: token("--app-header-height"),
        mobileHeaderHeight: token("--mobile-header-height"),
        mobileNavHeight: token("--mobile-nav-height"),
        mainPadTop,
        mainPadBottom,
        topPinnedHeight,
        bottomPinnedHeight,
        contentClearsHeader:
          mainPadTop === null || topPinnedHeight === 0 || mainPadTop >= topPinnedHeight - 2,
        contentClearsBottomBar:
          mainPadBottom === null || bottomPinnedHeight === 0 || mainPadBottom >= bottomPinnedHeight - 2,
        pinned
      };
    }));

    await page.screenshot({ path: join(OUT, `${route.replace(/[^a-z0-9]/gi, "_")}.png`) });
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 160);
  }
  report.push(row);
  await page.close();
}

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log("\n=== SAFE AREA: is geometry DERIVED from the insets? ===\n");
console.log("(env() is 0 in headless Chromium by design; what matters is the formula)\n");
let unsafe = 0;
for (const r of report) {
  const bad = (r.pinned || []).filter((p) => !p.safe);
  unsafe += bad.length;
  const flags = [];
  if (r.error) flags.push("ERROR");
  if (bad.length) flags.push(`HARD-CODED:${bad.length}`);
  if (r.contentClearsHeader === false) flags.push("CONTENT-UNDER-HEADER");
  if (r.contentClearsBottomBar === false) flags.push("CONTENT-UNDER-BOTTOM-BAR");
  console.log(
    `${r.route.padEnd(18)} header=${String(r.appHeaderHeight).padEnd(22)}` +
    ` padTop=${String(r.mainPadTop ?? "-").padStart(4)} padBot=${String(r.mainPadBottom ?? "-").padStart(4)}  ${flags.join("  ") || "OK"}`
  );
  for (const p of bad) console.log(`     ${p.edge.padEnd(6)} <${p.tag}> h=${p.height}  ${p.cls}`);
  if (r.error) console.log(`     ${r.error}`);
}
console.log(`\n${unsafe} pinned element(s) with geometry not derived from the safe-area tokens.`);
