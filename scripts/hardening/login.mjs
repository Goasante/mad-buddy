/**
 * Signs a local test user in through the REAL login UI and saves the browser
 * storage state, so every later probe runs as a genuinely authenticated
 * session rather than a fabricated cookie.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const email = process.argv[2] || "qa@local.test";
const password = process.argv[3] || "HardeningPass123!";
const out = process.argv[4] || "C:/mb-god/.hardening/auth-qa.json";
const BASE = process.env.MB_BASE || "http://localhost:3100";
mkdirSync("C:/mb-god/.hardening", { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 300)); });

await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
// Let React hydrate BEFORE filling. Without this the click can land on a
// not-yet-interactive button and the submit is simply lost.
await p.waitForTimeout(4000);
await p.fill('input[type="email"]', email);
await p.fill('input[type="password"]', password);
// The FIRST authenticated route compile in dev can take ~100s (Turbopack cold
// build), so this waits generously. A short wait here previously made a
// successful login look like a silent failure.
await p.click('button[type="submit"]');
// loginAction resolves, THEN the client calls window.location.assign(). Poll
// the URL rather than racing a single waitForURL against that handoff; the
// first authenticated route can also take ~100s to compile in dev.
const deadline = Date.now() + 240000;
while (Date.now() < deadline) {
  if (!new URL(p.url()).pathname.startsWith("/login")) break;
  await p.waitForTimeout(1000);
}
await p.waitForLoadState("domcontentloaded", { timeout: 240000 }).catch(() => {});
await p.waitForTimeout(4000);
console.log("landed:", p.url());
const err = await p.locator('[role="alert"], .text-destructive').first().textContent().catch(() => null);
if (err) console.log("form message:", err.trim().slice(0, 200));
await ctx.storageState({ path: out });
console.log("saved storage state ->", out);
await b.close();
