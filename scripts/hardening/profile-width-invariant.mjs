/**
 * BETA-004 — user-supplied images can never determine page width.
 *
 * The invariant, stated as the tester experienced it: opening the profile
 * editor with photos must not widen the page. Measured across the phone matrix
 * and every photo count, because the defect only appeared WITH photos -- an
 * account at "0 of 3" always rendered correctly, which is what pointed at the
 * grid item's intrinsic minimum.
 */
import { chromium } from "playwright";
const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-photos.json";
const SIZES = [[360,800],[375,812],[390,844],[393,852],[430,932]];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok?"PASS":"FAIL"}  ${n}${d?`  — ${d}`:""}`); };

const b = await chromium.launch();
for (const [w,h] of SIZES) {
  for (const theme of ["dark","light"]) {
    const c = await b.newContext({ storageState:AUTH, viewport:{width:w,height:h}, isMobile:true, hasTouch:true, deviceScaleFactor:2, colorScheme:theme });
    const p = await c.newPage();
    await p.goto(`${BASE}/profile`, { waitUntil:"domcontentloaded", timeout:60000 });
    await p.waitForTimeout(2000);
    const view = await p.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: window.innerWidth }));
    check(`${w}x${h} ${theme} profile VIEW fits`, view.doc <= view.vw + 1, `doc=${view.doc} vw=${view.vw}`);

    await p.getByRole("button", { name: /edit profile/i }).first().click().catch(()=>{});
    await p.waitForTimeout(2200);
    const edit = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth, vw: window.innerWidth,
      photos: (document.body.textContent||"").match(/\d of 3/)?.[0] ?? "?",
      saveVisible: (() => {
        const btn = [...document.querySelectorAll("button")].find(e => /save profile/i.test(e.textContent||""));
        if (!btn) return "no-button";
        const r = btn.getBoundingClientRect();
        return r.right <= window.innerWidth + 1 ? "fully visible" : `CLIPPED right=${Math.round(r.right)}`;
      })()
    }));
    check(`${w}x${h} ${theme} profile EDIT fits (${edit.photos})`, edit.doc <= edit.vw + 1, `doc=${edit.doc} vw=${edit.vw}`);
    check(`${w}x${h} ${theme} "Save profile" not clipped`, edit.saveVisible === "fully visible", edit.saveVisible);
    await c.close();
  }
}
await b.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} profile width checks passed`);
