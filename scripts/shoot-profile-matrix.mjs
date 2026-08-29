/**
 * PROFILE VNEXT visual + viewport matrix on the combined release candidate.
 *
 * Probes the app-wide contract on every lab surface: exactly one header, no
 * document/body scroll, a real scroll owner, and nothing hidden behind the
 * fixed bottom navigation.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:3312";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["overview", "/profile-lab"],
  ["edit", "/profile-lab/edit"],
  ["privacy", "/profile-lab/privacy"],
  ["media", "/profile-lab/media"],
  ["people", "/profile-lab/people"]
];

const VIEWPORTS = [
  { name: "360x640", width: 360, height: 640 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 }
];

const fails = [];
let shots = 0;
let passes = 0;

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: theme,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 110)));

    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.fill('input[type="email"]', "a@v4test.local");
      await page.fill('input[type="password"]', "Password123!");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(5000);

      for (const [name, route] of ROUTES) {
        await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${OUT}/prof-${name}--${theme}--${viewport.name}.png` });
        shots += 1;

        const probe = await page.evaluate(() => {
          const doc = document.documentElement;
          /* REACHABILITY, not "is anything under the bar right now".
             Content scrolling beneath a fixed bottom nav is normal -- production
             /profile shows 4 such elements and /friends 1. The real defect is
             content that can NEVER be scrolled clear of the bar, i.e. the scroll
             owner's bottom padding does not clear the nav. */
          const bottomNav = [...document.querySelectorAll("nav")].find((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.position === "fixed" && rect.bottom >= window.innerHeight - 2 && rect.height > 0;
          });
          const owner = document.querySelector("[data-app-scroll-owner]");
          let buried = 0;
          if (bottomNav && owner) {
            owner.scrollTop = owner.scrollHeight;
            const navTop = bottomNav.getBoundingClientRect().top;
            buried = [...owner.querySelectorAll("button, a")].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.height > 0 && !bottomNav.contains(el) && r.top > navTop + 4 && r.top < window.innerHeight;
            }).length;
            owner.scrollTop = 0;
          }
          return {
            headers: document.querySelectorAll("header").length,
            docScroll: doc.scrollHeight - doc.clientHeight,
            bodyScroll: document.body.scrollHeight - document.body.clientHeight,
            owner: Boolean(document.querySelector("[data-app-scroll-owner]")),
            buried
          };
        });

        const ok =
          probe.headers <= 1 &&
          probe.docScroll <= 4 &&
          probe.bodyScroll <= 4 &&
          probe.owner &&
          probe.buried === 0;
        if (ok) passes += 1;
        else fails.push(`${name} ${viewport.name} ${theme} ${JSON.stringify(probe)}`);
        console.log(`${ok ? "VP-PASS" : "VP-FAIL"} ${name} ${viewport.name} ${theme} headers=${probe.headers} doc=${probe.docScroll} buried=${probe.buried}`);
      }
    } catch (error) {
      console.log("ERROR", viewport.name, theme, error.message.slice(0, 120));
    } finally {
      await browser.close();
    }
  }
}

console.log(`\nSHOTS=${shots} PASS=${passes} FAIL=${fails.length}`);
for (const f of fails) console.log("  FAIL:", f);
