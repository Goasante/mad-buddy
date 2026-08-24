/**
 * Does the PRODUCTION client attempt the Realtime WebSocket?
 *
 * Signed out, so no real user's data is touched. This cannot prove delivery --
 * that needs an authenticated session -- but it proves the half that was
 * broken: whether CSP permits the connection at all. The local defect showed up
 * as a CSP violation in the console before any auth was involved.
 */
import { chromium } from "playwright";

const BASE = "https://mad-buddy.com";
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

const cspViolations = [];
const sockets = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy/i.test(t)) {
    // Redact any key material before recording.
    cspViolations.push(t.replace(/apikey=[^\s'"&]+/g, "apikey=<redacted>").slice(0, 220));
  }
});
page.on("websocket", (ws) => sockets.push(ws.url().split("?")[0]));

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(6000);

const csp = await page.evaluate(() => {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  return meta ? meta.getAttribute("content") : null;
});

const header = await (await fetch(BASE)).headers.get("content-security-policy");
const connect = (header || "").split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src")) || "";

check("production CSP authorises wss:// for Supabase",
  /wss:\/\/[a-z0-9]+\.supabase\.co/.test(connect),
  (connect.match(/wss:\/\/[a-z0-9]+\.supabase\.co/) || ["none"])[0]);

check("production CSP also authorises https:// for REST",
  /https:\/\/[a-z0-9]+\.supabase\.co/.test(connect));

check("no duplicated origin without a socket scheme", (() => {
  const m = connect.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) || [];
  return m.length === 1;
})(), `${(connect.match(/https:\/\/[a-z0-9]+\.supabase\.co/g) || []).length} https occurrences`);

check("no CSP violations on the signed-out landing page",
  cspViolations.length === 0,
  cspViolations[0] || "clean");

console.log(`\nwebsockets attempted while signed out: ${sockets.length} ${sockets.length ? JSON.stringify(sockets) : "(expected: none — no session)"}`);
console.log(`meta CSP present: ${csp ? "yes" : "no (header only)"}`);

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} production realtime-policy checks passed`);
