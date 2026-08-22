/**
 * Runtime probe for the God Mode hardening program.
 *
 * Source inspection cannot close a user-visible finding, so every claim about
 * behaviour in this program is made against a real browser. This drives
 * Chromium at real device sizes, captures console output (hydration warnings
 * included), page errors and failed requests, and writes screenshots.
 *
 * Usage:
 *   node scripts/hardening/probe.mjs --routes /settings,/profile --size 393x852
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Accepts both `--flag=value` and `--flag value`. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const BASE = args.base || "http://localhost:3100";
const OUT = args.out || "C:/mb-god/.hardening/shots";
const SIZE = (args.size || "393x852").split("x").map(Number);
const THEME = args.theme === "dark" ? "dark" : "light";
/**
 * Route list.
 *
 * Git Bash rewrites a bare "/" argument into a Windows path (MSYS path
 * conversion), which silently turned the landing-page probe into a request for
 * "C:/Program Files/Git/". Anything that does not start with "/" after
 * trimming is therefore treated as the site root.
 */
const routes = String(args.routes || "/")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => (r.startsWith("/") ? r : "/"));
const storageState = args.auth || undefined;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: SIZE[0], height: SIZE[1] },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: THEME,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ...(storageState ? { storageState } : {})
});

const report = [];

for (const route of routes) {
  const page = await context.newPage();
  const messages = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") messages.push({ type: t, text: m.text().slice(0, 900) });
  });
  page.on("pageerror", (e) => messages.push({ type: "pageerror", text: String(e).slice(0, 900) }));
  page.on("requestfailed", (r) => {
    const f = r.failure();
    // Aborted navigations are normal during client routing; only surface real failures.
    if (f && !/ERR_ABORTED/.test(f.errorText)) {
      messages.push({ type: "requestfailed", text: `${r.method()} ${r.url().slice(0, 200)} — ${f.errorText}` });
    }
  });

  let status = null;
  let finalUrl = null;
  let error = null;
  try {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res?.status() ?? null;
    // Let hydration actually run — hydration warnings appear after the initial paint.
    await page.waitForTimeout(2500);
    finalUrl = page.url();
    const slug = route.replace(/[^a-z0-9]/gi, "_") || "root";
    await page.screenshot({
      path: join(OUT, `${slug}__${SIZE[0]}x${SIZE[1]}__${THEME}.png`),
      fullPage: false
    });
    // Horizontal overflow check — a mobile-first product must never scroll sideways.
    const overflow = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      viewWidth: window.innerWidth,
      overflowing: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    report.push({ route, status, finalUrl, overflow, messages });
  } catch (e) {
    error = String(e).slice(0, 400);
    report.push({ route, status, finalUrl, error, messages });
  }
  await page.close();
}

await browser.close();
writeFileSync(join(OUT, `report-${SIZE[0]}x${SIZE[1]}-${THEME}.json`), JSON.stringify(report, null, 2));

for (const r of report) {
  console.log(`\n=== ${r.route} → HTTP ${r.status}${r.finalUrl && !r.finalUrl.endsWith(r.route) ? ` (landed: ${r.finalUrl})` : ""}`);
  if (r.error) console.log(`  ERROR: ${r.error}`);
  if (r.overflow?.overflowing) console.log(`  ⚠ HORIZONTAL OVERFLOW: doc ${r.overflow.docWidth}px > viewport ${r.overflow.viewWidth}px`);
  const seen = new Set();
  for (const m of r.messages) {
    const k = m.type + m.text.slice(0, 200);
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  [${m.type}] ${m.text}`);
  }
  if (!r.messages.length && !r.error) console.log("  (clean)");
}
