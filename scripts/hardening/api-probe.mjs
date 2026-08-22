import { chromium } from "playwright";
const url = process.argv[2] || "/api/notifications?limit=10";
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: "C:/mb-god/.hardening/auth-qa.json" });
const p = await ctx.newPage();
await p.goto("http://localhost:3100/settings", { waitUntil: "domcontentloaded", timeout: 240000 });
const r = await p.evaluate(async (u) => {
  const res = await fetch(u, { headers: { accept: "application/json" } });
  return { status: res.status, body: (await res.text()).slice(0, 1500) };
}, url);
console.log("STATUS", r.status);
console.log("BODY", r.body);
await b.close();
