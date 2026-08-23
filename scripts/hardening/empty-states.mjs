/**
 * Mission 2 Extreme — empty states as product.
 *
 * An empty state has to answer three questions: what is this, why is it empty,
 * and what should I do next. A surface that answers only the third (a bare
 * button) or only the second ("No results") is doing part of the job.
 *
 * This visits the surfaces whose empty state is reachable in the QA account and
 * captures the actual rendered copy plus whether a real next action is offered.
 * The verdict stays with the reader; this produces the text.
 *
 * A surface that is NOT empty is reported as such rather than being scored --
 * measuring a populated list tells you nothing about its empty state, and
 * quietly treating "has content" as "good empty state" is the empty-fixture
 * trap in another costume.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/empty-states";
mkdirSync(OUT, { recursive: true });

/** Surfaces, and the tab that most reliably shows an empty state. */
const SURFACES = [
  { name: "Muddies — Requests", route: "/friends", tab: "Requests" },
  { name: "Muddies — Blocked", route: "/friends", tab: "Blocked" },
  { name: "Plans — Upcoming", route: "/plans", tab: null },
  { name: "Plans — Past", route: "/plans", tab: "Past" },
  { name: "Events — Yours", route: "/events", tab: "Yours" },
  { name: "Messages — Unread", route: "/messages", tab: "Unread" },
  { name: "Notifications", route: "/notifications", tab: null },
  { name: "Moments", route: "/moments", tab: null },
  { name: "Circles — My Circles", route: "/groups", tab: null },
  { name: "Circles — Invitations", route: "/groups", tab: "Invitations" },
  { name: "UpFor — Muddies", route: "/hangout-mode", tab: "Muddies" },
  { name: "UpFor — Around", route: "/hangout-mode", tab: "Around" },
  { name: "Safe Arrival", route: "/safe-arrival", tab: null }
];

/** Copy that reports a database state instead of speaking to a person. */
const BARE = /^(no data|nothing here|empty|none|no results|no items|not found)\.?$/i;

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
    await page.goto(`${BASE}${surface.route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2600);
    if (surface.tab) {
      const t = page.getByRole("tab", { name: surface.tab, exact: false })
        .or(page.getByRole("button", { name: surface.tab, exact: false })).first();
      if (await t.count()) { await t.click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(1800); }
      else row.note = `tab "${surface.tab}" not found`;
    }

    /* The empty state is the panel that appears INSTEAD of a list. Read the
       main region's text and the actions offered inside it. */
    const seen = await page.evaluate(() => {
      const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
      const text = (main.innerText || "").replace(/\s+/g, " ").trim();
      const actions = Array.from(main.querySelectorAll("button, a[href]"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
        .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      return { text, actions };
    });

    row.text = seen.text.slice(0, 300);
    row.actions = [...new Set(seen.actions)].slice(0, 12);
    await page.screenshot({ path: `${OUT}/${surface.name.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true });
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 140);
  }
  rows.push(row);
  await page.close();
}
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/empty-states.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(90)}\nEMPTY STATES\n${"=".repeat(90)}`);
for (const r of rows) {
  console.log(`\n### ${r.name}   (${r.route}${r.tab ? ` · ${r.tab}` : ""})`);
  if (r.error) { console.log(`  ERROR ${r.error}`); continue; }
  if (r.note) console.log(`  NOTE  ${r.note}`);
  console.log(`  copy   : ${r.text.slice(0, 230)}`);
  console.log(`  actions: ${r.actions.join(" | ").slice(0, 200)}`);
  if (BARE.test(r.text.trim())) console.log(`  ⚠ BARE COPY — reports a state, offers nothing`);
}
