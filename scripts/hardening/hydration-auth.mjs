/** Hydration + console check across AUTHENTICATED routes, using a real session. */
import { chromium } from "playwright";

/* The port was hard-coded to 3100 (dev). A production-build pass runs on
 * 3200, so this silently reported ERR_CONNECTION_REFUSED as if it were a
 * finding. Overridable, defaulting to the production-build port. */
const BASE = process.env.MB_BASE || "http://localhost:3200";
const routes = (process.argv[2] || "/settings").split(",");
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
  storageState: "C:/mb-god/.hardening/auth-qa.json"
});
for (const route of routes) {
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push("PAGEERROR " + String(e)));
  let url = "?";
  try {
    await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await p.waitForTimeout(3500);
    url = p.url();
  } catch (e) { errs.push("NAV " + String(e).slice(0, 200)); }
  const hyd = errs.filter((e) => /hydrat/i.test(e));
  const other = errs.filter((e) => !/hydrat/i.test(e) && !/Content Security Policy/i.test(e));
  console.log(`\n### ${route} -> ${url}`);
  console.log(`  hydration: ${hyd.length ? "MISMATCH" : "clean"}`);
  for (const e of other.slice(0, 4)) console.log(`  [error] ${e.slice(0, 260)}`);
  await p.close();
}
await b.close();
