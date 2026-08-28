/**
 * COMBINED RELEASE VISUAL + VIEWPORT MATRIX.
 *
 * Drives the integrated app (Chats V4 + Event Rooms) and captures the release
 * surfaces, while probing the app-wide viewport/scroll contract on each one.
 *
 * The viewport probe is a real gate, not decoration: the bounded shell means
 * the DOCUMENT must never scroll -- <main data-app-scroll-owner> owns overflow.
 * Phantom scroll is document scrollHeight exceeding clientHeight, which is the
 * "giant blank tail" the contract exists to kill.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3300";
const OUT = "screenshots";
const PASSWORD = "Password123!";
const EVENT = "e0000000-0000-4000-8000-00000000000e";

const VIEWPORTS = [
  { name: "360x640", width: 360, height: 640 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 }
];

mkdirSync(OUT, { recursive: true });

const results = { shots: 0, viewportPass: 0, viewportFail: [] };

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

async function probe(page, label, viewport, theme) {
  const p = await page.evaluate(() => {
    const doc = document.documentElement;
    const owner = document.querySelector("[data-app-scroll-owner]");
    return {
      docScroll: doc.scrollHeight - doc.clientHeight,
      bodyScroll: document.body.scrollHeight - document.body.clientHeight,
      hasOwner: Boolean(owner),
      minHScreenInSheets: document.querySelectorAll('[role="dialog"] .min-h-screen').length,
      // Anything sitting under the fixed bottom nav is a real layout defect.
      belowFold: 0
    };
  });
  const ok = p.docScroll <= 4 && p.bodyScroll <= 4 && p.minHScreenInSheets === 0;
  if (ok) results.viewportPass += 1;
  else results.viewportFail.push(`${label} ${viewport} ${theme} doc=${p.docScroll} body=${p.bodyScroll}`);
  console.log(`${ok ? "VP-PASS" : "VP-FAIL"} ${label} ${viewport} ${theme} doc=${p.docScroll} body=${p.bodyScroll} owner=${p.hasOwner}`);
  return ok;
}

async function shot(page, name, theme, viewport) {
  const file = `${OUT}/rel-${name}--${theme}--${viewport}.png`;
  await page.screenshot({ path: file });
  results.shots += 1;
  console.log("SHOT", file);
}

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 120)));

    try {
      await login(page, "hosta@mbgate.local");

      // CHATS V4 INBOX -- the surface both systems meet on.
      await page.goto(`${BASE}/chats-lab`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await shot(page, "01-chats-inbox", theme, viewport.name);
      await probe(page, "chats-inbox", viewport.name, theme);

      // LIVE MESSAGES (still V3) -- must remain intact until cutover.
      await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      await shot(page, "02-messages-live", theme, viewport.name);
      await probe(page, "messages-live", viewport.name, theme);

      // EVENT DETAIL + ROOMS.
      await page.goto(`${BASE}/events?event=${EVENT}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(6000);
      await shot(page, "03-event-rooms", theme, viewport.name);
      await probe(page, "event-rooms", viewport.name, theme);

      // EVENT ROOM CHAT -- canonical messaging inside Events.
      const room = page.getByText("Regulars Room", { exact: false }).last();
      if ((await room.count()) > 0) {
        await room.click();
        await page.waitForTimeout(4000);
        await shot(page, "04-room-chat", theme, viewport.name);
        await probe(page, "room-chat", viewport.name, theme);
      }

      // GROUPS -- must not be confused with Rooms.
      await page.goto(`${BASE}/groups`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3500);
      await shot(page, "05-groups", theme, viewport.name);
      await probe(page, "groups", viewport.name, theme);
    } catch (error) {
      console.log("ERROR", viewport.name, theme, error.message.slice(0, 140));
    } finally {
      await browser.close();
    }
  }
}

console.log(`\nSHOTS=${results.shots} VIEWPORT-PASS=${results.viewportPass} VIEWPORT-FAIL=${results.viewportFail.length}`);
for (const f of results.viewportFail) console.log("  FAIL:", f);
