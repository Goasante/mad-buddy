/**
 * BETA-004 production verification.
 *
 * Cannot log into a real user's account, so this proves the invariant the way
 * it actually holds: the shipped CSS constrains the component regardless of
 * photo count. The live stylesheet is fetched from production and applied to a
 * faithful reconstruction of the editor markup at 0, 1 and 3 photos.
 *
 * This is honest about what it is: a production-CSS test, not a production-
 * session test. The full end-to-end run (real account, 3 real photos) passed
 * 30/30 locally against the identical stylesheet.
 */
import { chromium } from "playwright";

const CSS = "https://mad-buddy.com/_next/static/chunks/2nqg1y8ewc78s.css";
const SIZES = [[360,800],[390,844],[430,932]];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok?"PASS":"FAIL"}  ${n}${d?`  — ${d}`:""}`); };

const css = await (await fetch(CSS)).text();
check("live production CSS carries min-width:0 on .profile-photos",
  /\.profile-photos\{[^}]*min-width:0/.test(css));
check("live production CSS wraps the controls row",
  /\.profile-photos-controls\{[^}]*flex-wrap:wrap/.test(css));

const markup = (n) => `
<div style="width:100%">
  <div class="grid gap-4" style="display:grid;gap:1rem">
    <section class="profile-photos">
      <div class="profile-photos-head">
        <p class="profile-photos-title">Photos</p>
        <p class="profile-photos-count">${n} of 3</p>
      </div>
      ${n > 0 ? `<div class="profile-photos-frame"><img class="profile-photos-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='3000' height='4000'%3E%3C/svg%3E"></div>` : ""}
      ${n > 0 ? `<div class="profile-photos-controls">
        <div class="profile-photos-visibility">
          <button class="profile-photos-chip">Everyone</button>
          <button class="profile-photos-chip profile-photos-chip-on">My Muddies</button>
          <button class="profile-photos-chip">Only me</button>
        </div>
        <div class="profile-photos-move">
          <button class="profile-photos-move-button">&larr;</button>
          <button class="profile-photos-move-button">&rarr;</button>
        </div>
        <button class="profile-photos-remove">&times;</button>
      </div>` : ""}
    </section>
    <div><label>Username</label><p>Lowercase letters, numbers, and underscores.</p><input value="kofi" style="width:100%"></div>
    <div style="display:flex;justify-content:flex-end;gap:.5rem">
      <button>Cancel</button><button id="save">Save profile</button>
    </div>
  </div>
</div>`;

const browser = await chromium.launch();
for (const [w, h] of SIZES) {
  for (const n of [0, 1, 3]) {
    const ctx = await browser.newContext({ viewport:{width:w,height:h}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
    const page = await ctx.newPage();
    /* A viewport meta tag is REQUIRED. Without it the mobile emulation reports
       the default 980px layout viewport, and every width produced identical
       numbers -- a test that passed while measuring nothing. */
    await page.setContent(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>${css}</style>
      <style>body{margin:0;padding:1rem;box-sizing:border-box}*{box-sizing:border-box}</style>
      </head><body>${markup(n)}</body></html>`, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const save = document.getElementById("save").getBoundingClientRect();
      return {
        doc: document.documentElement.scrollWidth,
        vw: window.innerWidth,
        saveRight: Math.round(save.right)
      };
    });
    check(`${w}px · ${n} photo${n===1?"":"s"} · no document overflow`,
      r.doc <= r.vw + 1, `doc=${r.doc} vw=${r.vw}`);
    check(`${w}px · ${n} photo${n===1?"":"s"} · Save on-screen`,
      r.saveRight <= r.vw + 1, `right=${r.saveRight}`);
    await ctx.close();
  }
}
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} production CSS width checks passed`);
