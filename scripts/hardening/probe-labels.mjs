/**
 * Why did six task-cost journeys time out on a click?
 *
 * All six failed identically, and one of them ("check notifications") targets a
 * bottom-nav control that demonstrably works. That pattern points at the
 * HARNESS, not the product — so before recording any of them as interaction
 * defects, this dumps what is actually clickable on the starting surface.
 *
 * A failing check is a question, not a verdict.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const ROUTE = process.env.MB_ROUTE || "/dashboard";
const WANT = (process.env.MB_WANT || "Notifications").split("|");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});
const page = await ctx.newPage();
await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3500);

for (const want of WANT) {
  console.log(`\n=== target "${want}" on ${ROUTE}`);
  for (const role of ["button", "link"]) {
    const loc = page.getByRole(role, { name: want, exact: false });
    const n = await loc.count();
    if (!n) { console.log(`  role=${role}: 0 matches`); continue; }
    console.log(`  role=${role}: ${n} matches`);
    for (let i = 0; i < Math.min(n, 6); i += 1) {
      const el = loc.nth(i);
      const box = await el.boundingBox().catch(() => null);
      const vis = await el.isVisible().catch(() => false);
      const txt = (await el.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 40);
      console.log(`     [${i}] visible=${vis} box=${box ? `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.y)}` : "null"} text="${txt}"`);
    }
  }
  const byText = page.getByText(want, { exact: false });
  console.log(`  getByText: ${await byText.count()} matches`);
}

// What overlays the page? A tour or dialog intercepting pointer events is the
// classic cause of "the control is there and visible but the click times out".
const blockers = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll("[role=dialog], [data-tour], [data-state=open], .fixed")) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width * r.height > window.innerWidth * window.innerHeight * 0.4 && st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) > 0.05) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 90), z: st.zIndex, pe: st.pointerEvents, area: Math.round(r.width) + "x" + Math.round(r.height) });
    }
  }
  return out;
});
console.log(`\nfull-ish overlays present: ${blockers.length}`);
for (const b of blockers) console.log(`  ${b.tag} z=${b.z} pe=${b.pe} ${b.area} ${b.cls}`);

await page.screenshot({ path: "C:/mb-god/.hardening/probe-labels.png", fullPage: false });
await ctx.close();
await browser.close();
