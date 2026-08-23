/**
 * Information-architecture capture.
 *
 * Mission 2/4 ask what each screen is FOR, and whether what it shows earns its
 * place. That judgement needs the real rendered content — section headings, the
 * order they appear in, and how much vertical space each consumes — not a
 * reading of the JSX.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.MB_BASE || "http://localhost:3200";
const OUT = "C:/mb-god/.hardening/ia";
mkdirSync(OUT, { recursive: true });
const routes = (process.argv[2] || "/profile").split(",");

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true,
  storageState: "C:/mb-god/.hardening/auth-prod.json"
});

const all = [];
for (const route of routes) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(2200);

  const data = await p.evaluate(() => {
    const main = document.querySelector("main, #app-main-content, [role=main]") || document.body;
    const vh = window.innerHeight;

    // Section-level structure: headings and the blocks they introduce.
    const blocks = [];
    for (const el of main.querySelectorAll("section, h1, h2, h3, [class*=card], [class*=Card]")) {
      const r = el.getBoundingClientRect();
      if (r.height < 8) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (!text) continue;
      blocks.push({
        tag: el.tagName.toLowerCase(),
        heading: /^h[1-3]$/.test(el.tagName.toLowerCase()),
        top: Math.round(r.top + window.scrollY),
        height: Math.round(r.height),
        // Screens of vertical space this block occupies.
        screens: +(r.height / vh).toFixed(2),
        text: text.slice(0, 90)
      });
    }
    return {
      title: document.title,
      totalHeight: Math.round(document.documentElement.scrollHeight),
      screens: +(document.documentElement.scrollHeight / vh).toFixed(2),
      firstScreenText: (main.innerText || "").trim().replace(/\s+/g, " ").slice(0, 400),
      blocks: blocks.filter((x) => x.heading || x.height > 40).slice(0, 40)
    };
  });

  // Full-page screenshot so the whole surface can be judged at once.
  await p.screenshot({ path: `${OUT}/${route.replace(/[^a-z0-9]/gi, "_")}-full.png`, fullPage: true });
  all.push({ route, ...data });
  await p.close();
}
await b.close();
writeFileSync(`${OUT}/ia.json`, JSON.stringify(all, null, 2));

for (const r of all) {
  console.log(`\n=== ${r.route}  (${r.screens} screens tall, ${r.totalHeight}px) ===`);
  console.log(`first view: ${r.firstScreenText.slice(0, 200)}\n`);
  for (const b of r.blocks) {
    const mark = b.heading ? "H" : " ";
    console.log(`  ${mark} y=${String(b.top).padStart(5)} h=${String(b.height).padStart(4)} (${String(b.screens).padStart(4)} scr)  ${b.text.slice(0, 68)}`);
  }
}
