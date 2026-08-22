/** Captures the FULL React hydration-mismatch diff, which names the component. */
import { chromium } from "playwright";
const route = process.argv[2] || "/signup";
const browser = await chromium.launch();
const page = await browser.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, colorScheme: "light"
}).then((c) => c.newPage());
const out = [];
page.on("console", (m) => { if (m.type() === "error") out.push(m.text()); });
page.on("pageerror", (e) => out.push("PAGEERROR " + String(e)));
await page.goto(`http://localhost:3100${route}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(4000);
await browser.close();
for (const t of out) { console.log("────────────"); console.log(t); }
if (!out.length) console.log("(no console errors)");
