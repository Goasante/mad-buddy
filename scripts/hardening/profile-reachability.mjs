/**
 * Nothing may become unreachable by the Profile restructure (MB-GOD-013).
 *
 * Every destination Profile's removed Privacy/Preferences/Support blocks linked
 * to must still be reachable from inside the app — checked by actually finding
 * and following the link in Settings, not by grepping for the string.
 */
import { chromium } from "playwright";
const BASE = "http://localhost:3200";
/* /settings is not in this list: it IS the receiving page, so it cannot link to
   itself. An earlier version included it and reported a false MISS. */
const MOVED = [
  ["/settings/appearance", "Appearance"],
  ["/settings/sessions", "sessions"],
  ["/settings/glow-visibility", "Glow"],
  ["/help", "Help"],
  ["/settings/feedback", "feedback"],
  ["/about", "About"]
];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true, storageState:"C:/mb-god/.hardening/auth-prod.json" })).newPage();

await p.goto(`${BASE}/settings`, { waitUntil:"domcontentloaded", timeout:60000 });
await p.waitForTimeout(2200);
const hrefs = await p.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map(a => a.getAttribute("href")));

console.log("=== every moved destination is linked from Settings ===");
let missing = 0;
for (const [href, label] of MOVED) {
  const found = hrefs.some(h => h === href || h?.startsWith(href + "?"));
  if (!found) missing += 1;
  console.log(`  ${found ? "OK  " : "MISS"}  ${href.padEnd(30)} (${label})`);
}

console.log("\n=== each destination actually loads ===");
for (const [href] of MOVED) {
  const res = await p.goto(`${BASE}${href}`, { waitUntil:"domcontentloaded", timeout:60000 });
  await p.waitForTimeout(700);
  const status = res.status();
  console.log(`  ${status}  ${href}`);
  if (status >= 400) missing += 1;
}
await b.close();
console.log(`\n${missing} unreachable destination(s).`);
