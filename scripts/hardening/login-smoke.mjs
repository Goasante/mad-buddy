import { chromium } from "playwright";
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await c.newPage();
await p.goto("http://localhost:3200/login", { waitUntil:"domcontentloaded", timeout:60000 });
await p.waitForTimeout(1500);
await p.fill('input[type="email"]', "reviewyaw@review.local");
await p.fill('input[type="password"]', "ReviewPass123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(6000);
console.log("landed on:", new URL(p.url()).pathname);
const errs = [];
p.on("console", m => { if (m.type()==="error") errs.push(m.text().slice(0,90)); });
// Exercise the surfaces whose RLS just changed.
for (const r of ["/dashboard","/messages","/plans","/groups","/safe-arrival"]) {
  await p.goto("http://localhost:3200"+r, { waitUntil:"domcontentloaded", timeout:60000 });
  await p.waitForTimeout(2200);
  const body = await p.evaluate(() => document.body.innerText.slice(0,150).replace(/\s+/g," "));
  const broke = /something went wrong|error occurred|failed to load/i.test(body);
  console.log(`${r.padEnd(15)} ${broke ? "ERROR PAGE" : "ok"}  ${body.slice(0,60)}`);
}
if (errs.length) console.log("console errors:", errs.slice(0,4));
await b.close();
