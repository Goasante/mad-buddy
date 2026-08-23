/**
 * Mission 2 God Mode, Axis 1 — product vocabulary.
 *
 * Two questions, kept separate because they have different answers:
 *
 *   PEOPLE   — how is one person named across surfaces? A known inconsistency
 *              exists (Home says "Kofi", /friends says "Kofi Mensah"), and the
 *              question is whether that is considered or accidental.
 *   FEATURES — does one concept have one user-facing name? Internal identifiers
 *              may differ; what a user READS should not.
 *
 * This captures the accessible name of every control mentioning a known person,
 * plus every occurrence of the feature vocabulary in visible text, so drift is
 * visible as data rather than as an impression.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = "C:/mb-god/.hardening/auth-prod.json";
const OUT = "C:/mb-god/.hardening/vocabulary";
mkdirSync(OUT, { recursive: true });

const ROUTES = ["/dashboard", "/friends", "/messages", "/plans", "/events",
                "/linkr", "/hangout-mode", "/notifications", "/groups",
                "/profile", "/settings", "/safe-arrival"];

// The cast, and the tokens that would reveal how each surface names them.
const PEOPLE = ["Kofi Mensah", "Kofi", "Ama Boateng", "Ama", "@kofim", "@amab"];

// User-facing feature vocabulary. Pairs that must not BOTH appear are checked
// after collection.
const TERMS = ["Muddy", "Muddies", "friend", "Friend", "Linkr", "UpFor",
               "Plan", "Event", "Circle", "Group", "Safe Arrival", "Glow",
               "Nearby", "Going", "Check in", "Checked in", "Hangout"];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: AUTH, viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["geolocation"], geolocation: { latitude: 5.6508, longitude: -0.1869 }
});

const rows = [];
for (const route of ROUTES) {
  const page = await ctx.newPage();
  const row = { route };
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    Object.assign(row, await page.evaluate(({ people, terms }) => {
      const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
      const text = (main.innerText || "").replace(/\s+/g, " ");

      // How controls NAME a person: the accessible name is what a screen
      // reader announces, and is where an inconsistency actually lands.
      const personControls = Array.from(document.querySelectorAll("button, a[href], [role=button]"))
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; })
        .map((el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim())
        .filter((n) => n && people.some((p) => n.includes(p)))
        .map((n) => n.slice(0, 60));

      const termCounts = {};
      for (const t of terms) {
        // Word-boundary count in VISIBLE text only.
        // Every term here is plain letters and spaces, so no escaping is
        // needed; a term with regex metacharacters would need it.
        const re = new RegExp("(^|[^A-Za-z])" + t + "([^A-Za-z]|$)", "g");
        const n = (text.match(re) || []).length;
        if (n) termCounts[t] = n;
      }
      return { personControls: [...new Set(personControls)], termCounts };
    }, { people: PEOPLE, terms: TERMS }));
  } catch (e) {
    row.error = String(e).split("\n")[0].slice(0, 120);
  }
  rows.push(row);
  await page.close();
}
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/vocabulary.json`, JSON.stringify(rows, null, 2));

console.log(`\n${"=".repeat(92)}\nHOW EACH SURFACE NAMES A PERSON\n${"=".repeat(92)}`);
for (const r of rows) {
  if (!r.personControls?.length) continue;
  console.log(`\n${r.route}`);
  for (const n of r.personControls.slice(0, 8)) console.log(`   ${n}`);
}

console.log(`\n${"=".repeat(92)}\nFEATURE VOCABULARY (visible text)\n${"=".repeat(92)}`);
const all = {};
for (const r of rows) for (const [t, n] of Object.entries(r.termCounts ?? {})) {
  all[t] = (all[t] ?? 0) + n;
}
for (const [t, n] of Object.entries(all).sort((a, b) => b[1] - a[1])) {
  const where = rows.filter((r) => r.termCounts?.[t]).map((r) => r.route).join(" ");
  console.log(`  ${t.padEnd(14)} ${String(n).padStart(3)}   ${where}`);
}

// The pairs that would signal drift if BOTH are user-visible.
console.log(`\nCOMPETING PAIRS`);
for (const [a, b] of [["Muddy", "friend"], ["Muddies", "friend"], ["Circle", "Group"], ["UpFor", "Hangout"]]) {
  if (all[a] && all[b]) console.log(`  ⚠ "${a}" (${all[a]}) and "${b}" (${all[b]}) both appear in visible text`);
  else console.log(`  ok  "${a}"/"${b}" — only one is user-visible`);
}
