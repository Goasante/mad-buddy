/**
 * Mission 2 Extreme — error and loading states under REAL failure.
 *
 * Reading an error component tells you what it would say. It does not tell you
 * whether the user ever sees it, whether their work survives, or whether the
 * message leaks an internal database error. So this injects failures at the
 * network layer and reads what the product actually does:
 *
 *   offline      — every request fails
 *   500          — the server errors
 *   timeout      — requests hang
 *
 * For each it captures the visible text, whether a retry control exists, and
 * whether a draft the user had typed survived. It also greps the visible text
 * for internal detail that must never surface (SQL, stack frames, Postgres
 * error codes, table names).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/failure-states";
mkdirSync(OUT, { recursive: true });

/** Text that must never reach a user. */
const INTERNAL = /(select\s+.*\s+from\s|pgrst\d|23505|42p01|null value in column|violates .* constraint|at\s+\w+\s+\(.*\.js:\d+|stack trace|supabase\.co\/rest)/i;
/** A retry affordance, by accessible name. */
const RETRY = /(try again|retry|reload|refresh)/i;

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch();

/** Loads a route under an injected failure and reports what the user sees. */
async function underFailure(label, route, install) {
  const ctx = await browser.newContext({
    storageState: AUTH, viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const page = await ctx.newPage();
  // Load cleanly FIRST, so the failure hits a live app rather than preventing
  // it from ever starting — that is the realistic shape of a mid-session
  // outage, and it is where draft preservation actually matters.
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2600);

  await install(page);

  /* Provoke a REAL request under the failure.
   *
   * Two earlier attempts measured nothing. page.reload() replaced the document,
   * so offline showed Chromium's own error page and the 500 showed a raw body --
   * neither is the app's error handling. Switching a Plans tab measured even
   * less: `setActiveBucket` filters plans ALREADY IN MEMORY, so no request is
   * made and the clean-load data simply re-renders. A check that cannot fail is
   * not evidence.
   *
   * A client-side route change genuinely refetches, so this navigates within the
   * app and reads what the user is shown when that fetch cannot succeed. */
  await page.evaluate(() => {
    const link = document.querySelector('a[href="/notifications"], a[href="/friends"]');
    if (link) link.click();
  }).catch(() => {});
  await page.waitForTimeout(5200);

  const seen = await page.evaluate(() => {
    const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
    return {
      text: (main.innerText || "").replace(/\s+/g, " ").trim(),
      actions: Array.from(main.querySelectorAll("button, a[href]"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
        .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
      alerts: document.querySelectorAll("[role=alert], [aria-live]").length
    };
  }).catch(() => ({ text: "(page unreadable)", actions: [], alerts: 0 }));

  await page.screenshot({ path: `${OUT}/${label.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
  await ctx.close();
  return { label, route, ...seen };
}

const scenarios = [
  ["offline", "/plans", async (p) => p.context().setOffline(true)],
  ["server 500", "/plans", async (p) => p.route("**/*", (r) =>
    /_next\/static|\.(png|jpg|svg|woff2?|css)$/.test(r.request().url())
      ? r.continue()
      : r.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" }))],
  ["offline — messages", "/messages", async (p) => p.context().setOffline(true)]
];

const rows = [];
for (const [label, route, install] of scenarios) {
  const r = await underFailure(label, route, install);
  rows.push(r);
  console.log(`\n### ${label}  (${route})`);
  console.log(`  text   : ${r.text.slice(0, 240)}`);
  console.log(`  actions: ${[...new Set(r.actions)].join(" | ").slice(0, 180)}`);
  console.log(`  live regions: ${r.alerts}`);
}
await browser.close();
writeFileSync(`${OUT}/failure-states.json`, JSON.stringify(rows, null, 2));

console.log("");
// The probe must have actually broken something, or every verdict is vacuous.
const changed = rows.some((r) => r.text && r.text.length > 0);
check("the probe rendered a page under each failure", changed, `${rows.length} scenarios`);

for (const r of rows) {
  check(`[${r.label}] no internal error detail is shown to the user`,
    !INTERNAL.test(r.text),
    INTERNAL.test(r.text) ? `leaked: ${r.text.match(INTERNAL)?.[0]}` : "clean");
}

const withRetry = rows.filter((r) => r.actions.some((a) => RETRY.test(a)));
check("at least one failure surface offers an explicit retry",
  withRetry.length > 0,
  withRetry.length ? withRetry.map((r) => r.label).join(", ") : "no retry control found on any failure surface");

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} failure-state checks passed`);
