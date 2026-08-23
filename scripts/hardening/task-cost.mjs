/**
 * Mission 2 Extremely Advanced — the task-cost matrix.
 *
 * Advanced asked whether each screen is structurally shippable. Extreme asks
 * what the product COSTS: for each ordinary goal, the shortest normal
 * successful path, measured rather than estimated.
 *
 * Method notes that matter for trusting the numbers:
 *
 *  - Taps are COUNTED BY THE DRIVER, not declared by me. Each `tap` step
 *    increments the counter, so a path that needs an extra step to work
 *    reports the extra step. I cannot quietly under-count a flow by writing a
 *    smaller number in a table.
 *  - `screens` counts DISTINCT pathnames actually visited; `overlays` counts
 *    dialogs/sheets that opened. A modal is not a screen, and conflating them
 *    would make modal-based flows look more expensive than they are.
 *  - A task that does not COMPLETE is reported INCOMPLETE, never as a cheap
 *    path. "Setup failure is not PASS" applies here too: a flow that fell over
 *    after two taps has not achieved a two-tap cost.
 *  - `from` is the realistic starting surface, not whatever route makes the
 *    number look best. Most journeys start at /dashboard because that is where
 *    the app opens.
 *
 * The purpose is NOT to drive every task to one tap. It is to find cost that
 * buys the user nothing.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/task-cost";
mkdirSync(OUT, { recursive: true });

/** Runs one task and returns its measured cost. */
export async function measureTask(browser, task) {
  const ctx = await browser.newContext({
    storageState: AUTH,
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ["geolocation"],
    geolocation: { latitude: 5.6508, longitude: -0.1869 }
  });
  const page = await ctx.newPage();

  const cost = {
    task: task.name, from: task.from,
    taps: 0, typing: 0, decisions: task.decisions ?? 0,
    screens: [], overlays: 0,
    complete: false, notes: [], trace: []
  };

  const seen = new Set();
  const noteScreen = () => {
    const p = new URL(page.url()).pathname;
    if (!seen.has(p)) { seen.add(p); cost.screens.push(p); }
  };

  /** Counts a dialog/sheet that is currently open. */
  const overlayOpen = () => page.evaluate(() =>
    document.querySelectorAll("[role=dialog][data-state=open], [role=menu], [data-radix-popper-content-wrapper]").length > 0
  ).catch(() => false);

  try {
    await page.goto(`${BASE}${task.from}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2600);
    noteScreen();

    for (const step of task.steps) {
      if (step.do === "tap") {
        /* Resolve by identity, widening only as far as needed.
         *
         * The first version defaulted to role "button" and fell back to visible
         * TEXT. That silently missed every icon-only control -- Notifications
         * is an <a> whose accessible name comes from aria-label and whose
         * innerText is empty, so both attempts found nothing and the step timed
         * out looking like a product defect. Six journeys failed that way.
         * Trying the declared role, then link/button, then text, means a
         * mis-declared role costs nothing and only a genuinely absent control
         * fails. */
        const candidates = [];
        if (step.role) candidates.push(page.getByRole(step.role, { name: step.text, exact: step.exact ?? false }));
        for (const role of ["button", "link"]) {
          if (role !== step.role) candidates.push(page.getByRole(role, { name: step.text, exact: step.exact ?? false }));
        }
        candidates.push(page.getByText(step.text, { exact: false }));

        let target = null;
        for (const c of candidates) {
          if (await c.count()) { target = c.first(); break; }
        }
        if (!target) throw new Error(`no control named "${step.text}" (any role)`);
        await target.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
        const before = await overlayOpen();
        await target.click({ timeout: step.timeout ?? 15000 });
        cost.taps += 1;
        await page.waitForTimeout(step.wait ?? 2000);
        const after = await overlayOpen();
        if (!before && after) cost.overlays += 1;
        noteScreen();
        cost.trace.push(`tap "${step.text}" -> ${new URL(page.url()).pathname}`);
      } else if (step.do === "type") {
        await page.locator(step.selector).first().fill(step.value, { timeout: 15000 });
        cost.typing += 1;
        cost.trace.push(`type into ${step.selector}`);
      } else if (step.do === "expect-text") {
        const body = await page.locator("body").innerText();
        if (!body.toLowerCase().includes(step.contains.toLowerCase())) {
          throw new Error(`completion marker "${step.contains}" absent`);
        }
        cost.trace.push(`saw "${step.contains}"`);
      } else if (step.do === "expect-url") {
        if (!page.url().includes(step.contains)) throw new Error(`url lacks "${step.contains}"`);
        cost.trace.push(`url has "${step.contains}"`);
      }
    }
    cost.complete = true;
  } catch (e) {
    cost.notes.push(String(e).split("\n")[0].slice(0, 150));
  }

  await page.screenshot({ path: `${OUT}/${task.name.replace(/[^a-z0-9]/gi, "_")}.png`, fullPage: true }).catch(() => {});
  await ctx.close();
  cost.screenCount = cost.screens.length;
  return cost;
}

export function printMatrix(rows) {
  console.log(`\n${"=".repeat(94)}`);
  console.log("TASK COST MATRIX  (393x852, touch, authenticated)");
  console.log("=".repeat(94));
  console.log("task                              from            taps  type  scr  ovl  done");
  console.log("-".repeat(94));
  for (const r of rows) {
    console.log(
      `${r.task.padEnd(33).slice(0, 33)} ${String(r.from).padEnd(15).slice(0, 15)} ` +
      `${String(r.taps).padStart(4)}  ${String(r.typing).padStart(4)}  ` +
      `${String(r.screenCount).padStart(3)}  ${String(r.overlays).padStart(3)}  ${r.complete ? "yes" : "NO"}`
    );
    if (!r.complete && r.notes.length) console.log(`      └─ ${r.notes[0]}`);
  }
  const done = rows.filter((r) => r.complete).length;
  console.log("-".repeat(94));
  console.log(`${done}/${rows.length} tasks completed`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("task-cost.mjs");
if (invokedDirectly) {
  const browser = await chromium.launch();
  const { TASKS } = await import("./task-cost-tasks.mjs");
  const rows = [];
  for (const t of TASKS) {
    const r = await measureTask(browser, t);
    rows.push(r);
    console.log(`${r.complete ? "done" : "INCOMPLETE"}  ${r.task}  (${r.taps} taps)`);
  }
  await browser.close();
  writeFileSync(`${OUT}/task-cost.json`, JSON.stringify(rows, null, 2));
  printMatrix(rows);
}
