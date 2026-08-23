/**
 * Mission 4 Advanced — page responsibility and duplicate-index detection.
 *
 * Mission 2 asked whether each screen is good. Mission 4 asks whether the things
 * on it BELONG there. Two questions are answerable mechanically, and both were
 * the shape of the Profile defect (MB-GOD-013):
 *
 *   1. DUPLICATE INDEX — does a surface link to a set of destinations that
 *      another canonical index already owns? Profile carried a second copy of
 *      Settings; every row only linked where Settings already linked.
 *
 *   2. MISPLACED RESPONSIBILITY — does a surface whose job is consumption
 *      carry administration, or vice versa?
 *
 * Judgement stays with the reader. This produces the link topology so the
 * reader is judging evidence rather than memory.
 *
 * The guided tour is dismissed on every surface; an undismissed run audits the
 * overlay rather than the page.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/ia";
mkdirSync(OUT, { recursive: true });

/** Every canonical authenticated surface, with the job the brief assigns it. */
const SURFACES = [
  { route: "/dashboard", name: "Home", job: "ORCHESTRATION" },
  { route: "/friends", name: "Muddies", job: "RELATIONSHIP MANAGEMENT" },
  { route: "/linkr", name: "Linkr", job: "DISCOVERY" },
  { route: "/hangout-mode", name: "UpFor", job: "TEMPORARY INTENT" },
  { route: "/plans", name: "Plans", job: "COMMITMENT" },
  { route: "/events", name: "Events", job: "PUBLISHED EXPERIENCE" },
  { route: "/messages", name: "Messages", job: "COMMUNICATION" },
  { route: "/groups", name: "Circles", job: "COMMUNICATION" },
  { route: "/safe-arrival", name: "Safe Arrival", job: "SAFETY" },
  { route: "/profile", name: "Profile", job: "IDENTITY" },
  { route: "/settings", name: "Settings", job: "SETTINGS / ADMINISTRATION" },
  { route: "/notifications", name: "Pulse", job: "RE-ENTRY" },
  { route: "/moments", name: "Moments", job: "PUBLISHED EXPERIENCE" },
  { route: "/badges", name: "Badges", job: "IDENTITY" },
  { route: "/buddy-score", name: "Buddy Score", job: "IDENTITY" },
  { route: "/invites", name: "Invites", job: "RELATIONSHIP MANAGEMENT" },
  { route: "/discover", name: "Discover", job: "DISCOVERY" },
  { route: "/drops", name: "Drops", job: "PUBLISHED EXPERIENCE" },
  { route: "/meeting-pings", name: "Meeting pings", job: "COMMUNICATION" },
  { route: "/reminders", name: "Reminders", job: "SETTINGS / ADMINISTRATION" },
  { route: "/safety", name: "Safety centre", job: "SAFETY" },
  { route: "/help", name: "Help", job: "SETTINGS / ADMINISTRATION" }
];

/* Destinations that are ADMINISTRATION. A consumption surface linking to
   several of these is carrying a settings index it does not own. */
const ADMIN_PREFIXES = ["/settings", "/billing", "/upgrade", "/privacy", "/terms", "/help", "/about", "/faq"];

const READ = () => {
  const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
  /* MAIN CONTENT ONLY, AND THE SHELL IS INSIDE IT.
   *
   * `<main>` CONTAINS the app header, so a naive main-only query still picked
   * up /notifications and /friends?tab=requests on every single surface --
   * making every page look like it duplicated an index. Header, nav and any
   * shell furniture are excluded explicitly. */
  const shell = [...document.querySelectorAll("header, nav, [data-app-shell]")];
  const inShell = (el) => shell.some((s) => s.contains(el));
  const links = Array.from(main.querySelectorAll("a[href]"))
    .filter((el) => !inShell(el))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
    .map((el) => el.getAttribute("href") || "")
    .filter((h) => h.startsWith("/"));
  return {
    links: [...new Set(links)],
    heading: (document.querySelector("h1")?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40)
  };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});

const rows = [];
for (const surface of SURFACES) {
  const page = await ctx.newPage();
  const row = { ...surface };
  try {
    const res = await page.goto(`${BASE}${surface.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    row.status = res?.status() ?? null;
    await page.waitForTimeout(2800);
    for (let i = 0; i < 3; i += 1) {
      const nt = page.getByRole("button", { name: /not now|skip|dismiss/i }).first();
      if (await nt.count()) { await nt.click().catch(() => {}); await page.waitForTimeout(800); } else break;
    }
    row.landed = new URL(page.url()).pathname;
    Object.assign(row, await page.evaluate(READ));
    row.adminLinks = row.links.filter((h) => ADMIN_PREFIXES.some((p) => h.startsWith(p)));
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 110);
    row.links = [];
    row.adminLinks = [];
  }
  rows.push(row);
  await page.close();
}
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/responsibility.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(96)}\nSURFACE RESPONSIBILITY — main-content links only\n${"=".repeat(96)}`);
for (const r of rows) {
  if (r.error) { console.log(`\n${r.route.padEnd(16)} ERROR ${r.error}`); continue; }
  const redirected = r.landed !== r.route;
  console.log(`\n${r.route.padEnd(16)} ${r.job}${redirected ? `   → REDIRECTED to ${r.landed}` : ""}`);
  console.log(`   heading: ${r.heading || "(none)"}`);
  console.log(`   links  : ${r.links.length}  ${r.links.slice(0, 8).join(" ")}`);
  if (r.adminLinks.length) {
    console.log(`   ⚠ administration links: ${r.adminLinks.length}  ${r.adminLinks.join(" ")}`);
  }
}

// A consumption surface carrying several administration destinations is the
// Profile defect's shape.
console.log(`\n${"=".repeat(96)}\nDUPLICATE-INDEX CANDIDATES\n${"=".repeat(96)}`);
const settingsRow = rows.find((r) => r.route === "/settings");
const settingsLinks = new Set(settingsRow?.links ?? []);
let flagged = 0;
for (const r of rows) {
  if (r.route === "/settings" || r.error) continue;
  const overlap = r.links.filter((h) => settingsLinks.has(h));
  const isConsumption = !["SETTINGS / ADMINISTRATION"].includes(r.job);
  if (isConsumption && overlap.length >= 3) {
    flagged += 1;
    console.log(`  ⚠ ${r.route}: ${overlap.length} destinations Settings already owns — ${overlap.join(" ")}`);
  }
}
console.log(flagged === 0
  ? "  none — no consumption surface duplicates the Settings index"
  : `  ${flagged} surface(s) to investigate`);
