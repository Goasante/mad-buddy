/**
 * MB-GOD-041 regression: the offline shell replaces Chrome's error page.
 *
 * Before the fix, tapping an in-app link while offline produced
 * `chrome-error://chromewebdata/` -- outside the app, and in an installed PWA
 * with no address bar, unrecoverable.
 *
 * Every assertion states what would make it fail, and the run asserts the
 * PRE-CONDITION first (the worker is actually controlling the page), because a
 * shell that is never reached would otherwise "pass" by the page simply not
 * breaking.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true
});
const page = await ctx.newPage();

await page.goto(`${BASE}/plans`, { waitUntil: "domcontentloaded", timeout: 60000 });
// The worker installs, precaches, then claims. Give it room; a shell that has
// not finished precaching cannot be served, and that is a timing artefact
// rather than a defect.
await page.waitForTimeout(6000);

const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const names = await caches.keys();
  const cache = names.find((n) => n.startsWith("mad-buddy-offline-"));
  const cached = cache ? (await (await caches.open(cache)).keys()).map((r) => new URL(r.url).pathname) : [];
  return { controlled: Boolean(navigator.serviceWorker.controller), names, cached };
});
check("the service worker controls the page", sw.controlled, JSON.stringify(sw.names));
check("the offline shell and its script are precached",
  sw.cached.includes("/offline.html") && sw.cached.includes("/offline.js"),
  `cached: ${sw.cached.join(", ") || "(nothing)"}`);
check("NOTHING but the offline assets is cached",
  sw.cached.every((p) => p === "/offline.html" || p === "/offline.js"),
  `${sw.cached.length} entries`);

// --- The actual scenario ---------------------------------------------------
await ctx.setOffline(true);
await page.evaluate(() => {
  const l = document.querySelector('a[href="/notifications"]') || document.querySelector('nav a[href]');
  if (l) l.click();
});
await page.waitForTimeout(6000);

const url = page.url();
check("the user is NOT dropped on the browser's error page",
  !url.startsWith("chrome-error:"),
  url.startsWith("chrome-error:") ? "chrome-error://chromewebdata/" : url);

const shell = await page.evaluate(() => ({
  text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
  hasRetry: Boolean(document.getElementById("retry")),
  hasHome: Boolean(document.querySelector('a[href="/dashboard"]')),
  scriptRan: typeof window.addEventListener === "function" && Boolean(document.getElementById("status"))
})).catch((e) => ({ text: `(unreadable: ${String(e).slice(0, 60)})` }));

check("an offline explanation is shown", /offline/i.test(shell.text || ""), shell.text);
check("a retry control is offered", Boolean(shell.hasRetry), shell.hasRetry ? "Try again" : "absent");
check("a way back into the app is offered", Boolean(shell.hasHome), shell.hasHome ? "Go to Home" : "absent");

// The shell must carry no user data. Names from the fixture cast would be the
// tell-tale of a cached authenticated page.
const leaked = ["Kofi", "Ama", "QA Tester", "@kofim", "detail-fixture"].filter((n) => (shell.text || "").includes(n));
check("the offline shell contains NO user data", leaked.length === 0,
  leaked.length ? `leaked: ${leaked.join(", ")}` : "static content only");

// --- Recovery --------------------------------------------------------------
await ctx.setOffline(false);
await page.waitForTimeout(4000);
const recovered = await page.evaluate(() => ({
  path: location.pathname,
  len: (document.body.innerText || "").trim().length
}));
check("coming back online recovers a real page on its own",
  recovered.len > 0 && recovered.path !== "/offline.html",
  `${recovered.path} (${recovered.len} chars)`);

await page.screenshot({ path: "C:/mb-god/.hardening/offline-shell.png" }).catch(() => {});
await ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} offline-shell checks passed`);
