/**
 * RUNTIME PROOF for the combined Account Doctor.
 *
 * Everything else in this tranche is unit or database-level. This is the only
 * check that a real operator, signed in against a real admin role, can reach
 * the Doctor, diagnose an account, and see the verification vocabulary
 * rendered -- desktop and mobile.
 *
 * Against `next start`, never `next dev`: its broken HMR socket blocks
 * hydration and every form silently fails.
 *
 * It deliberately does NOT run a repair. Repairs are proven against the
 * database in lib/admin/repair-recipes.local.test.ts, where the invariants can
 * actually be asserted; clicking one here would prove less and mutate fixture
 * state that other suites depend on.
 */
import { chromium } from "playwright";

const BASE = process.env.MB_BASE || "http://localhost:3310";
const EMAIL = "qa@local.test";
const PASSWORD = "HardeningPass123!";

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
}

const browser = await chromium.launch();
try {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 393, height: 852 }]
  ]) {
    console.log(`\n=== ${label} ===`);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    /* The console text for a failed fetch says only "400 (Bad Request)", which
       is not enough to tell a real Admin fault from unrelated telemetry. */
    const failedRequests = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
    });

    await login(page);

    // The Repair Centre itself must be reachable by a real support operator.
    const response = await page.goto(`${BASE}/admin/repairs`, {
      waitUntil: "networkidle",
      timeout: 60000
    });
    check(`${label}: /admin/repairs reachable`, (response?.status() ?? 0) < 400, `status ${response?.status()}`);

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(`${label}: not an access-denied page`, !/don't have permission|not authorised|forbidden/i.test(body));

    /* The coverage map is the visible contract for what Admin does and does not
       cover, so an operator must actually be able to see it. */
    check(`${label}: coverage map rendered`, /coverage|support operations/i.test(body));

    // Diagnose a real account through the UI.
    const search = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
    if ((await search.count()) > 0) {
      await search.fill("Kofi");
      await page.waitForTimeout(1500);
      const result = page.locator("button, [role='option']").filter({ hasText: /Kofi/i }).first();
      if ((await result.count()) > 0) {
        await result.click();
        await page.waitForTimeout(2500);
      }
    }

    const afterDiagnose = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(
      `${label}: Doctor produced findings for a real account`,
      /healthy|attention|issue|no obvious lifecycle mismatch/i.test(afterDiagnose)
    );

    await page.screenshot({ path: `.audit/admin-doctor-${label}.png`, fullPage: true });

    /* A repair must never be offered next to a safety finding. This is the one
       UI claim that carries real risk, so it is asserted on the rendered page
       rather than trusted from the model. */
    const unconfirmedShown = /without a confirmed arrival|without the traveller confirming/i.test(afterDiagnose);
    if (unconfirmedShown) {
      const repairButtons = await page.locator("button").filter({ hasText: /close a finished journey/i }).count();
      check(`${label}: no repair button beside an unconfirmed arrival`, repairButtons === 0);
    } else {
      console.log(`  (no unconfirmed-arrival finding on this account; safety-button check not applicable)`);
    }

    /* Storage 400s are excluded: local fixture profiles carry avatar_url values
       whose objects were never uploaded to the local storage bucket, so every
       page rendering an avatar reports one. That is a seed-data gap, not an
       Admin fault, and asserting on it would make this proof fail for a reason
       it is not testing. Real app errors are still caught. */
    const realErrors = consoleErrors.filter(
      /* "Failed to load resource" carries no URL in its console text, so it
         cannot be filtered by path -- the failing-request check above is what
         actually distinguishes a real fault from the fixture avatar. This list
         catches genuine script errors, which do carry their own message. */
      (text) => !/favicon|manifest|vapid|web push|404|failed to load resource/i.test(text)
    );
    const realFailedRequests = failedRequests.filter(
      (entry) => !/storage\/v1\/object|\/api\/profile\/avatar/i.test(entry)
    );
    for (const request of failedRequests) console.log(`  failed request: ${request}`);
    check(
      `${label}: no failing app request`,
      realFailedRequests.length === 0,
      realFailedRequests.slice(0, 2).join(" | ")
    );
    check(`${label}: no console errors`, realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nADMIN RUNTIME PROOF PASSED" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
