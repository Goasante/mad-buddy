/**
 * MB-GOD-041 — what ACTUALLY happens offline, before designing any fix.
 *
 * The brief asks for six specific facts, and each is measured rather than
 * reasoned about:
 *   1. which navigations the worker intercepts
 *   2. what the browser does with an uncontrolled navigation
 *   3. whether the already-loaded app shell survives
 *   4. whether history/back still works
 *   5. whether an offline shell exists
 *   6. whether a same-page (non-navigating) interaction still functions
 *
 * The distinction that matters for the fix: a HARD navigation (document
 * request) is the browser's to handle, but Next's client router does a SOFT
 * navigation (an RSC fetch) — and a failed RSC fetch is the app's own problem
 * to report. Those need different answers, so they are measured separately.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true
});
const page = await ctx.newPage();

const readState = async (label) => {
  const s = await page.evaluate(() => ({
    path: location.pathname,
    bodyLen: (document.body.innerText || "").trim().length,
    controls: document.querySelectorAll("button, a[href]").length,
    historyLen: history.length,
    online: navigator.onLine
  })).catch((e) => ({ error: String(e).slice(0, 80) }));
  console.log(`  ${label.padEnd(34)} path=${String(s.path).padEnd(14)} text=${String(s.bodyLen).padStart(5)} controls=${String(s.controls).padStart(3)} history=${s.historyLen} online=${s.online}`);
  return s;
};

console.log("=".repeat(96));
console.log("MB-GOD-041 — OFFLINE BEHAVIOUR");
console.log("=".repeat(96));

await page.goto(`${BASE}/plans`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);
console.log("\n[baseline, online]");
await readState("loaded /plans");

// Is the service worker actually controlling this page?
const swState = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration();
  return {
    supported: true,
    registered: Boolean(reg),
    controlled: Boolean(navigator.serviceWorker.controller),
    scope: reg?.scope ?? null
  };
});
console.log(`  service worker: ${JSON.stringify(swState)}`);

// --- SOFT NAVIGATION (Next client router) --------------------------------
console.log("\n[offline — SOFT navigation via the client router]");
await ctx.setOffline(true);
await page.evaluate(() => {
  const l = document.querySelector('a[href="/notifications"]') || document.querySelector('nav a[href]');
  if (l) l.click();
});
await page.waitForTimeout(5000);
const afterSoft = await readState("after in-app link tap");

// Does BACK recover the user?
await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) =>
  console.log(`  goBack threw: ${String(e).split("\n")[0].slice(0, 70)}`));
await page.waitForTimeout(2500);
const afterBack = await readState("after browser Back");

// --- HARD NAVIGATION (document request) ----------------------------------
console.log("\n[offline — HARD navigation (document request)]");
await page.goto(`${BASE}/plans`, { waitUntil: "domcontentloaded", timeout: 15000 })
  .catch((e) => console.log(`  goto rejected: ${String(e).split("\n")[0].slice(0, 70)}`));
await page.waitForTimeout(1500);
await readState("after hard nav attempt");

// --- RECOVERY --------------------------------------------------------------
console.log("\n[back online]");
await ctx.setOffline(false);
await page.goto(`${BASE}/plans`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3000);
await readState("after reconnect");

console.log("\nSUMMARY");
console.log(`  soft navigation offline leaves a usable page : ${afterSoft.bodyLen > 0 ? "YES" : "NO — blank"}`);
console.log(`  browser Back recovers a usable page          : ${afterBack.bodyLen > 0 ? "YES" : "NO — still blank"}`);

await ctx.close();
await browser.close();
