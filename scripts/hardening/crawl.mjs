/**
 * Route + control crawler for the God Mode hardening program.
 *
 * Built for the PRODUCTION runtime target (`npm start`), not dev: cold
 * Turbopack compilation distorts every timing and produced at least one false
 * timeout classification, so exhaustive passes run against built output.
 *
 * For each route it records:
 *   - HTTP status and the URL actually landed on (catches wrong destinations,
 *     redirect loops, and silent bounces to Home)
 *   - console errors, page errors, and any 4xx/5xx the page itself fired
 *   - horizontal overflow (a mobile-first product must never scroll sideways)
 *   - an inventory of every interactive control, including the ones that are
 *     easy to miss: role-bearing divs, tabs, links styled as cards, avatars
 *   - accessibility red flags that are cheap to detect and expensive to ship:
 *     nested interactive elements, controls with no accessible name, touch
 *     targets under 44px
 *   - a screenshot
 *
 * Usage:
 *   node scripts/hardening/crawl.mjs --auth <state.json> --routes /a,/b --size 393x852 --theme light
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
const BASE = args.base || "http://localhost:3200";
const [W, H] = String(args.size || "393x852").split("x").map(Number);
const THEME = args.theme === "dark" ? "dark" : "light";
const TAG = args.tag || `${W}x${H}-${THEME}`;
const OUT = args.out || `C:/mb-god/.hardening/crawl-${TAG}`;
const SHOTS = args.shots !== "false";
// Git Bash rewrites a leading "/" into a Windows path; anything that does not
// survive as a path segment is treated as the site root.
const routes = String(args.routes || "/").split(",").map((r) => r.trim()).filter(Boolean)
  .map((r) => (r.startsWith("/") ? r : "/"));

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: THEME,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ...(args.auth ? { storageState: args.auth } : {})
});

/** Runs in the page. Inventories controls and cheap a11y/geometry defects. */
const INSPECT = () => {
  const SEL = [
    "button", "a[href]", "[role=button]", "[role=link]", "[role=tab]",
    "[role=menuitem]", "[role=switch]", "[role=checkbox]", "[role=radio]",
    "input", "select", "textarea", "summary", "[onclick]", "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };

  const name = (el) =>
    (el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      (el.innerText || "").trim() ||
      el.getAttribute("placeholder") ||
      "").replace(/\s+/g, " ").slice(0, 60);

  const nodes = Array.from(document.querySelectorAll(SEL)).filter(visible);

  const controls = nodes.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      href: el.getAttribute("href") || null,
      name: name(el),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      w: Math.round(r.width),
      h: Math.round(r.height)
    };
  });

  /* Nested interactive elements: invalid HTML, and a real source of hydration
   * errors and unpredictable tap behaviour on touch devices.
   *
   * Scoped to elements that are THEMSELVES interactive. An earlier version
   * tested every node matching the broad selector above -- which includes
   * `[tabindex]` wrappers and role-bearing containers -- and reported an
   * ordinary <div> that merely CONTAINED a button as a nesting violation.
   * That produced a false positive on the Muddies surface; a precise re-check
   * found 0 genuine nestings across nine surfaces. */
  const REAL_INTERACTIVE = "button, a[href], input, select, textarea, [role=button], [role=link], [role=tab]";
  const nested = Array.from(document.querySelectorAll(REAL_INTERACTIVE))
    .filter(visible)
    .filter((el) => el.querySelectorAll(REAL_INTERACTIVE).length > 0)
    .map((el) => ({
      outer: el.tagName.toLowerCase(),
      name: name(el),
      inner: Array.from(el.querySelectorAll(REAL_INTERACTIVE)).map((i) => i.tagName.toLowerCase()).join(",")
    }))
    .slice(0, 20);

  // A control nobody can announce is a control a screen-reader user cannot use.
  const unnamed = controls
    .filter((c) => !c.name && !c.disabled && c.tag !== "input" && c.tag !== "select" && c.tag !== "textarea")
    .slice(0, 20);

  /* 44x44 is the long-standing minimum comfortable touch target.
   *
   * Deliberately EXCLUDES visually-hidden controls (a 1x1 "Skip to content"
   * link is a correct accessibility affordance, not an unreachable button) and
   * hidden file inputs, both of which are 1x1 by design. Reporting them buries
   * the real finding -- the 36-42px tab rows -- in noise. */
  const small = controls
    .filter((c) => !c.disabled && c.w > 1 && c.h > 1 && (c.w < 44 || c.h < 44))
    .slice(0, 30);

  // Links that go nowhere, and buttons in a permanent disabled state.
  const deadLinks = controls.filter((c) => c.tag === "a" && (!c.href || c.href === "#"));

  return {
    title: document.title,
    controlCount: controls.length,
    controls: controls.slice(0, 120),
    nested,
    unnamed,
    small,
    deadLinks,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    scrollH: document.documentElement.scrollHeight,
    // Empty-ish page detection: a route that renders almost nothing is usually
    // a silent failure rather than a deliberate minimal screen.
    textLength: (document.body.innerText || "").trim().length
  };
};

const report = [];

for (const route of routes) {
  const page = await context.newPage();
  const msgs = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Known local-only artifact: the CSP cannot derive ws:// from a local
    // http:// Supabase origin. Documented in scripts/hardening/README.md.
    if (/Content Security Policy|CHANNEL_ERROR|realtime/i.test(t)) return;
    msgs.push({ k: "console", t: t.slice(0, 400) });
  });
  page.on("pageerror", (e) => msgs.push({ k: "pageerror", t: String(e).slice(0, 400) }));
  page.on("response", (r) => {
    if (r.status() >= 400) msgs.push({ k: "http", t: `${r.status()} ${r.url().replace(BASE, "").slice(0, 160)}` });
  });

  const row = { route };
  const started = Date.now();
  try {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    row.status = res?.status() ?? null;
    await page.waitForTimeout(1800);
    row.ms = Date.now() - started;
    const u = new URL(page.url());
    row.landed = u.pathname + u.search;
    row.redirected = u.pathname !== route.split("?")[0];
    Object.assign(row, await page.evaluate(INSPECT));
    if (SHOTS) {
      await page.screenshot({ path: join(OUT, `${route.replace(/[^a-z0-9]/gi, "_") || "root"}.png`) });
    }
  } catch (e) {
    row.ms = Date.now() - started;
    row.error = String(e).split("\n")[0].slice(0, 200);
  }

  const seen = new Set();
  row.messages = msgs.filter((m) => {
    const k = m.k + m.t.slice(0, 150);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  report.push(row);
  await page.close();
}

await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(`\n=== CRAWL ${TAG} (${routes.length} routes) ===\n`);
for (const r of report) {
  const flags = [];
  if (r.error) flags.push("NAV-ERROR");
  if (r.redirected) flags.push(`REDIRECT->${r.landed}`);
  if (r.overflow) flags.push(`OVERFLOW ${r.docW}>${r.winW}`);
  if (r.textLength !== undefined && r.textLength < 40) flags.push(`NEARLY-EMPTY(${r.textLength}c)`);
  if (r.nested?.length) flags.push(`nested:${r.nested.length}`);
  if (r.unnamed?.length) flags.push(`unnamed:${r.unnamed.length}`);
  if (r.small?.length) flags.push(`small-target:${r.small.length}`);
  if (r.deadLinks?.length) flags.push(`deadlink:${r.deadLinks.length}`);
  if (r.messages?.length) flags.push(`err:${r.messages.length}`);
  console.log(
    `${String(r.status ?? "---").padEnd(4)} ${String(r.ms ?? "").padStart(6)}ms ` +
    `${String(r.controlCount ?? "-").padStart(4)}ctl  ${r.route.padEnd(26)} ${flags.join("  ") || "clean"}`
  );
  for (const m of (r.messages || []).slice(0, 3)) console.log(`         [${m.k}] ${m.t.slice(0, 190)}`);
  if (r.error) console.log(`         ${r.error}`);
}
