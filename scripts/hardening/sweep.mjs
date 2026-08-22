/**
 * Route sweep: for each route, records HTTP status, final URL (catching wrong
 * destinations and redirect loops), console errors, page errors, failed
 * requests, and horizontal overflow. Screenshots each one.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const eq = t.indexOf("=");
    if (eq !== -1) { out[t.slice(2, eq)] = t.slice(eq + 1); continue; }
    const k = t.slice(2), n = argv[i + 1];
    if (n && !n.startsWith("--")) { out[k] = n; i += 1; } else out[k] = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const BASE = args.base || "http://localhost:3100";
const [W, H] = String(args.size || "393x852").split("x").map(Number);
const THEME = args.theme === "dark" ? "dark" : "light";
const OUT = args.out || `C:/mb-god/.hardening/sweep-${W}x${H}-${THEME}`;
const routes = String(args.routes || "/").split(",").map((r) => r.trim()).filter(Boolean);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: THEME,
  ...(args.auth ? { storageState: args.auth } : {})
});

const report = [];
for (const route of routes) {
  const p = await ctx.newPage();
  const msgs = [];
  p.on("console", (m) => { if (m.type() === "error") msgs.push({ k: "console", t: m.text().slice(0, 400) }); });
  p.on("pageerror", (e) => msgs.push({ k: "pageerror", t: String(e).slice(0, 400) }));
  p.on("response", (r) => { if (r.status() >= 400) msgs.push({ k: "http", t: `${r.status()} ${r.url().replace(BASE, "").slice(0, 160)}` }); });

  const row = { route };
  try {
    const res = await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    row.status = res?.status() ?? null;
    await p.waitForTimeout(3000);
    row.landed = new URL(p.url()).pathname + new URL(p.url()).search;
    row.redirected = row.landed !== route;
    const geo = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      title: document.title,
      // Does anything interactive sit under the status bar / notch?
      topInset: getComputedStyle(document.documentElement).getPropertyValue("--app-header-height") || null
    }));
    Object.assign(row, geo);
    await p.screenshot({ path: join(OUT, `${route.replace(/[^a-z0-9]/gi, "_") || "root"}.png`) });
  } catch (e) {
    row.error = String(e).slice(0, 200);
  }
  // De-duplicate; realtime CSP noise is a known local-only artifact.
  const seen = new Set();
  row.messages = msgs.filter((m) => {
    if (/Content Security Policy|realtime|CHANNEL_ERROR/i.test(m.t)) return false;
    const k = m.k + m.t.slice(0, 150);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  report.push(row);
  await p.close();
}
await b.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

for (const r of report) {
  const flags = [];
  if (r.error) flags.push("NAV-ERROR");
  if (r.redirected) flags.push(`REDIRECT->${r.landed}`);
  if (r.overflow) flags.push(`OVERFLOW ${r.docW}>${r.winW}`);
  if (r.messages?.length) flags.push(`${r.messages.length} err`);
  console.log(`${String(r.status ?? "---").padEnd(4)} ${r.route.padEnd(28)} ${flags.join("  ") || "clean"}`);
  for (const m of (r.messages || []).slice(0, 3)) console.log(`       [${m.k}] ${m.t.slice(0, 200)}`);
  if (r.error) console.log(`       ${r.error}`);
}
