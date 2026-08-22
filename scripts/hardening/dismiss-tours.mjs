/**
 * Dismisses the guided tours for the QA account and re-saves auth state.
 *
 * The tours are a real product surface (and a first-run experience worth
 * auditing on its own), but they overlay every screen they introduce, so an
 * automated pass that does not dismiss them is testing the overlay rather than
 * the page beneath it.
 */
import { chromium } from "playwright";
const BASE = process.env.MB_BASE || "http://localhost:3200";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true, storageState:"C:/mb-god/.hardening/auth-prod.json" });
const p = await ctx.newPage();

const ROUTES = ["/dashboard","/friends","/messages","/plans","/events","/linkr","/hangout-mode","/profile","/settings","/notifications","/groups","/safe-arrival"];
for (const route of ROUTES) {
  await p.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded", timeout:120000 });
  await p.waitForTimeout(2200);
  // Dismiss up to a few chained tour steps per surface.
  for (let i = 0; i < 4; i += 1) {
    const btn = p.getByRole("button", { name: /^(Not now|Skip|Dismiss|Got it|Close)$/i }).first();
    if (!(await btn.count())) break;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(1200);
  }
  const still = await p.getByRole("button", { name: /^Not now$/i }).count();
  console.log(`${route}: ${still ? "tour STILL present" : "clear"}`);
}
await ctx.storageState({ path: "C:/mb-god/.hardening/auth-prod.json" });
console.log("\nauth state re-saved");
await b.close();
