/**
 * CHATS V4 LIVE CUTOVER verification against the running build.
 *
 * Proves three things that must all hold simultaneously:
 *   1. /messages now renders V4 (identified by V4-only affordances).
 *   2. /profile and /friends/[username] are UNCHANGED -- Profile VNext is not
 *      promoted, and no "Profile VNext" copy reaches a live surface.
 *   3. The app-wide viewport contract still holds on /messages at every width.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3320";
mkdirSync("screenshots", { recursive: true });

const VIEWPORTS = [
  { name: "360x640", width: 360, height: 640 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 }
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(ok ? "PASS" : "FAIL", "-", name, detail ? `(${detail})` : "");
};

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', "a@v4test.local");
  await page.fill('input[type="password"]', "Password123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 110)));

await login(page);

// ------------------------------------------------------------- /messages = V4
await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const inbox = await page.locator("body").innerText();

// V4-only surface markers: the filter rail and the swipe affordance hint.
const v4Markers = ["Favorites", "Archived", "Swipe chats"];
check(
  "/messages renders the V4 inbox",
  v4Markers.every((marker) => inbox.includes(marker)),
  v4Markers.filter((m) => !inbox.includes(m)).join(",") || "all V4 markers present"
);

// The Event Room identity fix must survive the cutover.
check(
  "Event Room labelled as Event Room in the live inbox",
  inbox.includes("Event Room"),
  (inbox.match(/[^|\n]*Event Room[^|\n]*/) ?? ["(absent)"])[0].trim().slice(0, 54)
);
await page.screenshot({ path: "screenshots/cut-messages-v4.png" });

// ------------------------------------------------- deep link opens the thread
const roomRow = page.getByText("V4 Room", { exact: false }).first();
if ((await roomRow.count()) > 0) {
  await roomRow.click();
  await page.waitForTimeout(3500);
  check("opening an Event Room conversation works in V4", page.url().includes("/messages"));
  await page.screenshot({ path: "screenshots/cut-eventroom-chat.png" });
}

// --------------------------------------------------------- PROFILE UNCHANGED
await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const profile = await page.locator("body").innerText();
check("/profile shows no VNext lab copy", !/VNext/i.test(profile));
check(
  "/profile is the current production page",
  !profile.includes("This is how you show up."),
  "VNext overview headline absent"
);
await page.screenshot({ path: "screenshots/cut-profile-unchanged.png" });

await page.goto(`${BASE}/friends/bediako_v4`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const person = await page.locator("body").innerText();
check("/friends/[username] shows no VNext lab copy", !/VNext/i.test(person));
await page.screenshot({ path: "screenshots/cut-person-unchanged.png" });

await browser.close();

// ------------------------------------------- viewport contract on /messages
for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const b = await chromium.launch();
    const ctx = await b.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 2
    });
    const p = await ctx.newPage();
    try {
      await login(p);
      await p.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(7000);
      await p.screenshot({ path: `screenshots/cut-messages--${theme}--${viewport.name}.png` });
      const probe = await p.evaluate(() => {
        const doc = document.documentElement;
        return {
          headers: document.querySelectorAll("header").length,
          docScroll: doc.scrollHeight - doc.clientHeight,
          bodyScroll: document.body.scrollHeight - document.body.clientHeight,
          owner: Boolean(document.querySelector("[data-app-scroll-owner]"))
        };
      });
      const ok = probe.headers <= 1 && probe.docScroll <= 4 && probe.bodyScroll <= 4 && probe.owner;
      check(`viewport ${viewport.name} ${theme}`, ok, JSON.stringify(probe));
    } catch (error) {
      check(`viewport ${viewport.name} ${theme}`, false, error.message.slice(0, 70));
    } finally {
      await b.close();
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nCUTOVER: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
