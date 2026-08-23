/**
 * Mission 2 Advanced — per-surface UX measurement.
 *
 * The Profile restructure worked because it was MEASURED first: 3.97 screens,
 * Showcase at 3.7%, Support at 17.6%. Those numbers turned "Profile feels
 * cluttered" into a decision anyone could check. This applies the same method to
 * the remaining surfaces.
 *
 * Captures, per surface:
 *   - page length in screens, and scroll depth
 *   - the first-screenful text (the 3-second test)
 *   - section headings in order, with the vertical space each occupies
 *   - every persistent control, and how many compete as a primary CTA
 *   - touch targets under 44px, unnamed controls, nested interactives
 *   - horizontal overflow
 *   - a full-page screenshot
 *
 * Judgement stays with the reader. This produces the evidence.
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
const OUT = args.out || `C:/mb-god/.hardening/ux-${W}x${H}-${THEME}`;
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
  permissions: ["geolocation"],
  geolocation: { latitude: 5.6508, longitude: -0.1869 },
  ...(args.auth && args.auth !== "none" ? { storageState: args.auth } : {})
});

/** Runs in the page. */
const MEASURE = () => {
  const vh = window.innerHeight;
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const name = (el) =>
    (el.getAttribute("aria-label") || (el.innerText || "").trim() || el.getAttribute("title") || "")
      .replace(/\s+/g, " ").slice(0, 40);

  // Section structure: headings in document order, with their span.
  const headings = Array.from(main.querySelectorAll("h1, h2, h3"))
    .filter(visible)
    .map((el) => ({
      level: Number(el.tagName[1]),
      text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60),
      top: Math.round(el.getBoundingClientRect().top + window.scrollY)
    }));

  const INTERACTIVE = "button, a[href], [role=button], [role=link], [role=tab], [role=switch], input, select, textarea";
  const controls = Array.from(document.querySelectorAll(INTERACTIVE))
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || null,
        name: name(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        // A control is "above the fold" if it is in the first screenful.
        aboveFold: r.top + window.scrollY < vh,
        // Rough prominence: full-width or filled controls read as primary.
        wide: r.width > window.innerWidth * 0.6
      };
    });

  const small = controls.filter((c) => c.w > 1 && c.h > 1 && (c.w < 44 || c.h < 44));
  const unnamed = controls.filter((c) => !c.name && !["input", "select", "textarea"].includes(c.tag));

  const nested = Array.from(document.querySelectorAll(INTERACTIVE))
    .filter(visible)
    .filter((el) => el.querySelectorAll(INTERACTIVE).length > 0)
    .map((el) => ({ tag: el.tagName.toLowerCase(), name: name(el) }));

  return {
    title: document.title,
    heightPx: Math.round(document.documentElement.scrollHeight),
    screens: +(document.documentElement.scrollHeight / vh).toFixed(2),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    firstScreen: (main.innerText || "").trim().replace(/\s+/g, " ").slice(0, 320),
    headings,
    controlCount: controls.length,
    aboveFoldControls: controls.filter((c) => c.aboveFold).length,
    wideAboveFold: controls.filter((c) => c.aboveFold && c.wide).map((c) => c.name).filter(Boolean),
    small: small.map((c) => ({ name: c.name, w: c.w, h: c.h })),
    unnamed: unnamed.map((c) => ({ tag: c.tag, role: c.role, w: c.w, h: c.h })),
    nested: nested.slice(0, 10)
  };
};

const report = [];
for (const route of routes) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Content Security Policy|CHANNEL_ERROR|realtime|orb-off|profile\/avatar/i.test(t)) return;
    errors.push(t.slice(0, 160));
  });

  const row = { route };
  try {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    row.status = res?.status() ?? null;
    await page.waitForTimeout(2200);
    row.landed = new URL(page.url()).pathname;
    Object.assign(row, await page.evaluate(MEASURE));
    await page.screenshot({ path: join(OUT, `${route.replace(/[^a-z0-9]/gi, "_").slice(0, 60) || "root"}.png`), fullPage: true });
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 160);
  }
  row.errors = [...new Set(errors)];
  report.push(row);
  await page.close();
}
await browser.close();
writeFileSync(join(OUT, "ux.json"), JSON.stringify(report, null, 2));

for (const r of report) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${r.route}   →  ${r.landed ?? "?"}   [${r.status ?? "ERR"}]`);
  if (r.error) { console.log(`  ERROR: ${r.error}`); continue; }
  console.log(`  length      : ${r.screens} screens (${r.heightPx}px)${r.overflow ? "   ⚠ HORIZONTAL OVERFLOW" : ""}`);
  console.log(`  controls    : ${r.controlCount} total, ${r.aboveFoldControls} above the fold`);
  if (r.wideAboveFold.length) console.log(`  wide/primary: ${r.wideAboveFold.slice(0, 6).join(" | ")}`);
  console.log(`  3-second    : ${r.firstScreen.slice(0, 200)}`);
  if (r.headings.length) {
    console.log(`  sections    :`);
    for (const h of r.headings.slice(0, 14)) console.log(`      h${h.level} y=${String(h.top).padStart(5)}  ${h.text}`);
  }
  if (r.small.length) console.log(`  ⚠ small targets: ${r.small.map((c) => `${c.name || "(unnamed)"} ${c.w}x${c.h}`).slice(0, 6).join(" | ")}`);
  if (r.unnamed.length) console.log(`  ⚠ unnamed controls: ${r.unnamed.length}`);
  if (r.nested.length) console.log(`  ⚠ nested interactive: ${r.nested.length}`);
  if (r.errors.length) console.log(`  ⚠ console: ${r.errors[0]}`);
}
