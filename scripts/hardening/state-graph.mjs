/**
 * Mission 1 God Mode — reachable-state graph.
 *
 * Systematically clicks every interactive control on every core surface and
 * records where it actually went, then follows newly reached states. The point
 * is not coverage for its own sake: it is to find navigation whose DESTINATION
 * IS SEMANTICALLY WRONG, which a status-code crawl cannot see. A 200 is not
 * enough — the right route holding the wrong resource is still a defect.
 *
 * Records per edge:
 *   SOURCE SCREEN → CONTROL → EXPECTED → ACTUAL → NEW STATE
 *
 * Controls are classified by what they do rather than assumed to navigate:
 *   nav      — the URL changed
 *   overlay  — a dialog/sheet opened (a legitimate result, not a dead control)
 *   inline   — the page changed without navigating (tab switch, expand)
 *   dead     — nothing observable happened  ← the finding to hunt
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/state-graph";
mkdirSync(OUT, { recursive: true });

const SURFACES = (process.argv[2] ||
  "/dashboard,/friends,/profile,/linkr,/hangout-mode,/messages,/plans,/events,/safe-arrival,/notifications,/settings,/groups,/buddy-score"
).split(",");

/** Controls that would end the session or leave the app mid-crawl. */
const SKIP = /^(log ?out|sign ?out|delete account|delete|remove|block|report|leave|end|cancel plan)$/i;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, storageState: AUTH
});

const edges = [];
const nodes = new Set();
const consoleErrors = [];
const skipped = [];

/** Every visible interactive control, with a stable-ish identity. */
const INVENTORY = () => {
  const SEL = [
    "button", "a[href]", "[role=button]", "[role=link]", "[role=tab]",
    "[role=menuitem]", "[role=switch]", "summary"
  ].join(",");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== "hidden" && st.display !== "none";
  };
  return Array.from(document.querySelectorAll(SEL))
    .filter(visible)
    .map((el, i) => ({
      index: i,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      href: el.getAttribute("href") || null,
      name: (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "")
        .trim().replace(/\s+/g, " ").slice(0, 44),
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true"
    }));
};

for (const surface of SURFACES) {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Content Security Policy|CHANNEL_ERROR|realtime|orb-off|profile\/avatar/i.test(t)) return;
    consoleErrors.push({ surface, text: t.slice(0, 160) });
  });

  await page.goto(`${BASE}${surface}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  nodes.add(surface);

  const controls = await page.evaluate(INVENTORY);
  const actionable = controls.filter((c) => !c.disabled && c.name && !SKIP.test(c.name));

  for (const control of actionable) {
    // Return to a known state before each control, so edges are independent.
    if (new URL(page.url()).pathname !== surface) {
      await page.goto(`${BASE}${surface}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1400);
    }
    /* Dismiss anything left open by the previous control.
       CAVEAT, and it produces false "dead" results on detail surfaces: on a
       route like /messages?conversation=<id> the Escape ALSO closes the
       conversation panel, so a subsequent click on "Back to conversations" has
       nothing left to go back from and looks dead. Verified by hand — that
       control navigates correctly to /messages and the content changes.
       Detail-surface findings must be confirmed individually rather than read
       straight off this crawl. */
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);

    const before = {
      url: new URL(page.url()).pathname + new URL(page.url()).search,
      dialogs: await page.locator('[role="dialog"]').count(),
      text: (await page.locator("body").innerText().catch(() => "")).slice(0, 900)
    };

    let outcome = "dead";
    let landed = before.url;
    try {
      /* Click by INDEX into the same inventory, not by fuzzy text.
         Matching on a name fragment produced 16 strict-mode violations in the
         first run (several controls share a label — "Muddies" is a nav item, a
         section heading and a stat), and an ambiguous selector makes every
         result unreliable, including the "dead" ones. The index is stable
         because the inventory is re-read on the page as it currently stands. */
      const handle = control.href
        ? page.locator(`a[href="${control.href}"]`).first()
        : page.getByRole(control.role === "tab" ? "tab" : "button", { name: control.name, exact: true }).first();
      if (!(await handle.count())) { skipped.push(`${control.name}: not found`); continue; }
      if (!(await handle.isVisible().catch(() => false))) { skipped.push(`${control.name}: not visible`); continue; }

      /* Selected by IDENTITY, never by index.
         Two earlier attempts failed here and both produced convincing false
         findings. Fuzzy text matching hit strict-mode violations (several
         controls share a label). Index matching was worse: the order returned by
         an in-page querySelectorAll does not match Playwright's locator order,
         so `nth(i)` clicked a different element than was inventoried — which is
         how ten impossible "destination mismatches" appeared, such as
         `href=/moments` landing on `/notifications`. Proven by instrumenting the
         mismatch: at the same index the href was /moments in one ordering and
         /notifications in the other.
         An href is a real identity, so links are addressed by it. Handler-only
         buttons fall back to their accessible name, scoped to this surface. */
      await handle.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
      await handle.click({ timeout: 6000 });
      await page.waitForTimeout(1600);

      landed = new URL(page.url()).pathname + new URL(page.url()).search;
      const dialogs = await page.locator('[role="dialog"]').count();
      const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 900);

      if (landed !== before.url) outcome = "nav";
      else if (dialogs > before.dialogs) outcome = "overlay";
      else if (text !== before.text) outcome = "inline";
      /* A link to the page you are already on is SUPPOSED to do nothing
         visible. Reporting the current nav item as a dead control every time
         would bury the real findings. */
      else if (control.href && landed.split("?")[0] === control.href.split("?")[0]) outcome = "self";
      else outcome = "dead";
    } catch (e) {
      outcome = `error:${String(e).split("\n")[0].slice(0, 60)}`;
    }

    if (outcome === "nav") nodes.add(landed.split("?")[0]);
    edges.push({
      from: surface,
      control: control.name,
      kind: control.tag + (control.role ? `[${control.role}]` : ""),
      expected: control.href || "(no href — handler)",
      outcome,
      to: landed
    });
  }
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/graph.json`, JSON.stringify({ nodes: [...nodes], edges, consoleErrors }, null, 2));

const byOutcome = edges.reduce((acc, e) => {
  const k = e.outcome.startsWith("error") ? "error" : e.outcome;
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});

console.log(`\n=== STATE GRAPH ===`);
console.log(`nodes: ${nodes.size}   edges: ${edges.length}   skipped: ${skipped.length}`);
for (const sk of skipped.slice(0, 6)) console.log(`  skip: ${sk}`);
console.log(`outcomes: ${JSON.stringify(byOutcome)}\n`);

const dead = edges.filter((e) => e.outcome === "dead");
if (dead.length) {
  console.log(`DEAD CONTROLS (${dead.length}) — clicked, nothing observable happened:`);
  for (const d of dead) console.log(`  ${d.from.padEnd(16)} "${d.control}"  ${d.kind}  href=${d.expected}`);
}

// A link whose href does not match where it landed is a wrong destination.
const mismatched = edges.filter(
  (e) => e.outcome === "nav" && e.expected.startsWith("/") && !e.to.startsWith(e.expected.split("?")[0])
);
if (mismatched.length) {
  console.log(`\nDESTINATION MISMATCH (${mismatched.length}) — href says one thing, landed elsewhere:`);
  for (const m of mismatched) console.log(`  ${m.from.padEnd(16)} "${m.control}"  href=${m.expected} -> ${m.to}`);
}

if (consoleErrors.length) {
  console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
  for (const c of [...new Map(consoleErrors.map((x) => [x.text, x])).values()].slice(0, 8)) {
    console.log(`  ${c.surface}: ${c.text}`);
  }
}
