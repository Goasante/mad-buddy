/**
 * Pre-hydration / native-submit form audit.
 *
 * MB-GOD-003 exposed a class of defect ordinary React testing misses entirely:
 * a <form> whose only submit path is an onSubmit handler still submits NATIVELY
 * when the page's JavaScript has not run, and a form with no `method` defaults
 * to GET — putting every field in the URL, the browser history, the access log
 * and any intermediate proxy.
 *
 * That was fixed on the four auth forms. This sweeps every OTHER form in the
 * product for the same shape, because the defect is structural: any form built
 * the same way has the same hole, whether or not anyone has noticed.
 *
 * Two complementary checks:
 *
 *   1. STATIC — every <form> in the source that has an onSubmit handler but no
 *      `method`. Cheap, exhaustive, and catches forms behind states this crawl
 *      cannot reach (a modal that needs three taps and a fixture to open).
 *
 *   2. RUNTIME — load each reachable form with JavaScript DISABLED, fill it,
 *      submit it, and assert nothing sensitive reached the URL. Source analysis
 *      cannot prove what the browser actually does.
 *
 * A form that fails closed without JS is fine. What must never happen is data
 * leaking into the URL on the way to failing.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const AUTH = process.env.MB_AUTH || "C:/mb-god/.hardening/auth-prod.json";

// ---------------------------------------------------------------------------
// 1. Static sweep
// ---------------------------------------------------------------------------

function sourceFormAudit() {
  const files = execSync(
    'grep -rl "<form" components app --include=*.tsx',
    { cwd: "C:/mb-god", encoding: "utf8" }
  ).trim().split("\n").filter(Boolean);

  const findings = [];
  for (const file of files) {
    const src = readFileSync(`C:/mb-god/${file}`, "utf8");
    // Each <form ...> opening tag, attributes included (may span lines).
    const tags = src.match(/<form[\s>][^>]*>/gs) || [];
    for (const tag of tags) {
      const hasMethod = /\bmethod\s*=/.test(tag);
      const hasAction = /\baction\s*=/.test(tag);
      const hasOnSubmit = /\bonSubmit\s*=/.test(tag);
      // action={serverAction} is React's own form handling and posts by design.
      if (hasMethod || hasAction) continue;
      if (!hasOnSubmit) continue;
      const line = src.slice(0, src.indexOf(tag)).split("\n").length;
      findings.push({ file, line, tag: tag.replace(/\s+/g, " ").slice(0, 110) });
    }
  }
  return findings;
}

console.log("=== STATIC: forms with onSubmit but no method/action ===\n");
const staticFindings = sourceFormAudit();
if (!staticFindings.length) {
  console.log("  none — every onSubmit form declares method or action\n");
} else {
  for (const f of staticFindings) console.log(`  ${f.file}:${f.line}\n      ${f.tag}`);
  console.log(`\n  ${staticFindings.length} form(s) that would submit as GET without JS\n`);
}

// ---------------------------------------------------------------------------
// 2. Runtime sweep, JavaScript disabled
// ---------------------------------------------------------------------------

/** Anything that must never appear in a URL. */
const SENSITIVE = [
  "password", "email", "token", "secret", "otp", "code=",
  "date_of_birth", "dob", "latitude", "longitude", "phone"
];

const CASES = [
  { route: "/login", auth: false },
  { route: "/signup", auth: false },
  { route: "/forgot-password", auth: false },
  { route: "/reset-password", auth: false },
  { route: "/profile", auth: true },
  { route: "/settings", auth: true },
  { route: "/settings/privacy", auth: true },
  { route: "/settings/notifications", auth: true },
  { route: "/plans", auth: true },
  { route: "/events", auth: true },
  { route: "/hangout-mode", auth: true },
  { route: "/messages", auth: true },
  { route: "/safe-arrival", auth: true },
  { route: "/invite", auth: true }
];

const browser = await chromium.launch();
console.log("=== RUNTIME: submit with JavaScript disabled ===\n");

let leaks = 0;
for (const { route, auth } of CASES) {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    javaScriptEnabled: false,
    ...(auth ? { storageState: AUTH } : {})
  });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });

    const forms = await page.locator("form").all();
    if (!forms.length) {
      console.log(`  ${route.padEnd(26)} no form rendered without JS`);
      await context.close();
      continue;
    }

    // Fill whatever the form offers, then submit it the way a browser would.
    for (const input of await page.locator('input:not([type=hidden])').all()) {
      const type = (await input.getAttribute("type")) || "text";
      const value = type === "email" ? "probe@local.test" : type === "password" ? "ProbeSecret123!" : "probe-value";
      await input.fill(value, { timeout: 3000 }).catch(() => {});
    }
    const submit = page.locator('button[type="submit"], input[type="submit"]').first();
    if (await submit.count()) {
      await submit.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    /* Only the QUERY STRING can leak — the path is fixed by the route.
       An earlier version searched the whole URL and reported /forgot-password
       and /reset-password as leaking "password", which is the route's own name.
       A detector that cannot tell a path from a payload is worse than none. */
    const url = page.url();
    const query = (new URL(url).search || "").toLowerCase();
    const found = SENSITIVE.filter((s) => query.includes(s));
    const method = await forms[0].getAttribute("method");
    if (found.length) {
      leaks += 1;
      console.log(`  ${route.padEnd(26)} LEAK: ${found.join(", ")}`);
      console.log(`      ${url.slice(0, 150)}`);
    } else {
      console.log(`  ${route.padEnd(26)} clean (${forms.length} form(s), method=${method || "none"})`);
    }
  } catch (e) {
    console.log(`  ${route.padEnd(26)} error: ${String(e).split("\n")[0].slice(0, 90)}`);
  }
  await context.close();
}

await browser.close();
console.log(`\n${leaks} route(s) leaked sensitive data into the URL without JavaScript.`);
console.log(`${staticFindings.length} form(s) flagged statically.`);
