/**
 * Signed-out production smoke test against the live domain.
 * Read-only: navigates and reads. Creates nothing, submits nothing.
 */
import { chromium } from "playwright";
const BASE = "https://mad-buddy.com";
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => errors.push(`PAGEERROR ${String(e).slice(0, 120)}`));

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2000);

const text = await page.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement?.closest("script,style,template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const p = []; let n; while ((n = w.nextNode())) p.push(n.textContent || "");
  return p.join(" ").replace(/\s+/g, " ");
});

check("landing renders", text.length > 500, `${text.length} chars`);
check("landing introduces Linkr", /Linkr/.test(text));
check("landing introduces UpFor", /UpFor/.test(text));
check("landing states the two discovery models", /Two ways people find each other/i.test(text));
check("no stale 'only approved Muddies' claim", !/Only Muddies you both approve can appear nearby/i.test(text));
check("no legacy tier language", !/Buddy Plus|Buddy Pro|upgrade your account/i.test(text));

const title = await page.title();
check("page title set", title.length > 3, title.slice(0, 60));

const desc = await page.evaluate(() => document.querySelector('meta[name="description"]')?.content ?? "");
check("meta description present", desc.length > 20, desc.slice(0, 60));

const horiz = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("no horizontal scroll on mobile", !horiz);

const real = errors.filter((e) => !/websocket|Failed to load resource.*40[34]|analytics|gtag/i.test(e));
check("no catastrophic console errors", real.length === 0, real.slice(0, 2).join(" | ") || "clean");

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} public smoke checks passed`);
