/**
 * Mission 2 Extreme — cross-feature handoffs, experientially.
 *
 * Mission 1 proved these are FUNCTIONALLY correct: the click reaches the right
 * destination with the right resource. Extreme asks a different question — is
 * context preserved, is intent preserved, and does the user understand why they
 * moved?
 *
 * So each handoff records not just "did it arrive" but what the destination
 * SAYS on arrival: whether the thing you came from is still named there. A
 * handoff that lands you on a correct but anonymous surface is functionally
 * right and experientially lost.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/handoffs";
mkdirSync(OUT, { recursive: true });

const HANDOFFS = [
  {
    name: "Muddies -> profile modal -> Messages",
    from: "/friends",
    steps: [
      { tap: "Kofi Mensah, open profile", exact: true },
      { tap: "Message" }
    ],
    // Arriving in a conversation, the peer must be named.
    expectContext: "Kofi"
  },
  {
    name: "Plan -> Plan Chat",
    from: "/plans",
    steps: [
      { tap: "Created by you" },
      { tap: "detail-fixture dinner" }
    ],
    expectContext: "dinner"
  },
  {
    name: "Notification -> its source",
    from: "/notifications",
    steps: [],
    expectContext: null
  },
  {
    name: "Home -> nearby Muddy",
    from: "/dashboard",
    steps: [{ tap: "Kofi, Just Around. Open profile" }],
    expectContext: "Kofi"
  },
  {
    name: "Quick actions -> Safe Arrival",
    from: "/dashboard",
    steps: [{ tap: "Open quick actions" }, { tap: "Safe Arrival" }],
    expectContext: "Safe Arrival"
  },
  {
    name: "Event -> detail",
    from: "/events",
    steps: [{ tap: "detail-fixture launch night" }],
    expectContext: "launch night"
  }
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});

const rows = [];
for (const h of HANDOFFS) {
  const page = await ctx.newPage();
  const row = { name: h.name, from: h.from, arrived: null, contextPreserved: null, trace: [] };
  try {
    await page.goto(`${BASE}${h.from}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    for (const s of h.steps) {
      let target = page.getByRole("button", { name: s.tap, exact: s.exact ?? false });
      if (!(await target.count())) target = page.getByRole("link", { name: s.tap, exact: s.exact ?? false });
      if (!(await target.count())) target = page.getByText(s.tap, { exact: false });
      const n = await target.count();
      if (!n) { row.trace.push(`MISSING "${s.tap}"`); break; }
      let clicked = false;
      for (let i = 0; i < Math.min(n, 4); i += 1) {
        if (await target.nth(i).isVisible().catch(() => false)) {
          await target.nth(i).click({ timeout: 12000 }); clicked = true; break;
        }
      }
      if (!clicked) { row.trace.push(`NOT VISIBLE "${s.tap}"`); break; }
      await page.waitForTimeout(2600);
      row.trace.push(`tap "${s.tap}" -> ${new URL(page.url()).pathname}`);
    }
    row.arrived = new URL(page.url()).pathname + new URL(page.url()).search;
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    row.visible = body.slice(0, 220);

    /* CONTEXT MUST BE PRESERVED BY ARRIVING SOMEWHERE NEW.
     *
     * The first version asked only "does the destination text mention the
     * thing I came from". That passes trivially when the tap did nothing at
     * all -- the source page still mentions its own content, so a handoff that
     * never moved scored PRESERVED. Three of six did exactly that.
     *
     * A handoff has to actually hand off: either the URL changed, or a dialog
     * opened over the list. Only then does naming the source mean anything. */
    const moved = row.arrived !== h.from;
    const overlay = await page.evaluate(() =>
      document.querySelectorAll("[role=dialog]").length > 0).catch(() => false);
    row.moved = moved;
    row.overlay = overlay;
    if (h.expectContext) {
      row.contextPreserved = (moved || overlay) && body.includes(h.expectContext);
      row.why = !moved && !overlay
        ? "did not move: no navigation and no dialog"
        : body.includes(h.expectContext) ? "source named on arrival" : "arrival does not name the source";
    }
    await page.screenshot({ path: `${OUT}/${h.name.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true });
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 140);
  }
  rows.push(row);
  await page.close();
}
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/handoffs.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(88)}\nCROSS-FEATURE HANDOFFS\n${"=".repeat(88)}`);
for (const r of rows) {
  console.log(`\n### ${r.name}`);
  console.log(`  path    : ${r.trace.join("  |  ") || "(no steps)"}`);
  console.log(`  arrived : ${r.arrived ?? r.error ?? "?"}`);
  if (r.contextPreserved !== null) {
    console.log(`  moved   : ${r.moved ? "navigated" : r.overlay ? "opened a dialog in place" : "NO — nothing happened"}`);
    console.log(`  context : ${r.contextPreserved ? "PRESERVED" : "NOT ESTABLISHED"} — ${r.why}`);
  }
  console.log(`  sees    : ${(r.visible || "").slice(0, 170)}`);
}
