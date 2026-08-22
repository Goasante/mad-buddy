/**
 * Pinpoints nested interactive elements (invalid HTML, unpredictable taps).
 *
 * Reports the outer element's own markup rather than its descendant text, so a
 * plain wrapper that merely CONTAINS a button is not confused with a genuine
 * control-inside-a-control.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const routes = (process.argv[2] || "/friends").split(",");
const auth = process.argv[3] || "C:/mb-god/.hardening/auth-prod.json";

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, storageState: auth
});

for (const route of routes) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(1500);
  const found = await p.evaluate(() => {
    const INTERACTIVE = "button, a[href], input, select, textarea, [role=button], [role=link], [role=tab]";
    const out = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      const inner = el.querySelectorAll(INTERACTIVE);
      if (!inner.length) continue;
      out.push({
        outer: el.outerHTML.slice(0, 180),
        outerTag: el.tagName.toLowerCase(),
        outerRole: el.getAttribute("role"),
        innerTags: Array.from(inner).map((i) => `${i.tagName.toLowerCase()}${i.getAttribute("role") ? `[${i.getAttribute("role")}]` : ""}`)
      });
    }
    return out;
  });
  console.log(`\n### ${route} — ${found.length} nested`);
  for (const f of found) {
    console.log(`  <${f.outerTag}${f.outerRole ? ` role=${f.outerRole}` : ""}> contains ${f.innerTags.join(", ")}`);
    console.log(`    ${f.outer.replace(/\s+/g, " ")}`);
  }
  await p.close();
}
await b.close();
