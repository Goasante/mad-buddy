import { chromium } from "playwright";
const BASE = process.env.MB_BASE || "http://localhost:3200";
const route = process.argv[2], needle = process.argv[3];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true, storageState:"C:/mb-god/.hardening/auth-prod.json" })).newPage();
await p.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded", timeout:60000 });
await p.waitForTimeout(1800);
const info = await p.evaluate((n) => {
  const out = [];
  for (const el of document.querySelectorAll("button, a[href]")) {
    const t = (el.innerText||"").trim();
    if (!t.toLowerCase().includes(n.toLowerCase())) continue;
    const r = el.getBoundingClientRect();
    out.push({ tag: el.tagName.toLowerCase(), cls: el.className, w: Math.round(r.width), h: Math.round(r.height), html: el.outerHTML.slice(0,200) });
  }
  return out;
}, needle);
console.log(JSON.stringify(info, null, 1));
await b.close();
