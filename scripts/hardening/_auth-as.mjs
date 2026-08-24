/** Sign in as a named local account and save storage state for reuse. */
import { chromium } from "playwright";
const [,, username, out] = process.argv;
const PASSWORDS = ["ReviewPass123!", "AccessReview123!", "HardeningPass123!", "BetaTest123!"];
const b = await chromium.launch();
const c = await b.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const p = await c.newPage();
let ok = false;
for (const pw of PASSWORDS) {
  await p.goto("http://localhost:3200/login", { waitUntil:"domcontentloaded", timeout:60000 });
  await p.waitForTimeout(1200);
  await p.fill('input[type="email"]', `${username}@review.local`);
  await p.fill('input[type="password"]', pw);
  await p.click('button[type="submit"]');
  await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(()=>{});
  await p.waitForTimeout(1000);
  if (!new URL(p.url()).pathname.startsWith("/login")) { ok = true; break; }
}
console.log(ok ? `signed in as ${username}` : `FAILED to sign in as ${username}`);
if (ok) await c.storageState({ path: out });
await b.close();
