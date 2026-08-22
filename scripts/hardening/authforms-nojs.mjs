import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:393,height:852}, javaScriptEnabled: false });
const cases = [
  ["/login",           { 'input[type="email"]':"qa@local.test", 'input[type="password"]':"SecretPw123!" }],
  ["/signup",          { 'input[type="email"]':"new@local.test", 'input[type="password"]':"SecretPw123!" }],
  ["/forgot-password", { 'input[type="email"]':"qa@local.test" }]
];
for (const [route, fields] of cases) {
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3100${route}`, { waitUntil:"domcontentloaded", timeout:240000 });
  for (const [sel, val] of Object.entries(fields)) {
    const el = p.locator(sel).first();
    if (await el.count()) await el.fill(val).catch(()=>{});
  }
  const btn = p.locator('button[type="submit"]').first();
  if (await btn.count()) { await btn.click().catch(()=>{}); await p.waitForTimeout(3000); }
  const url = p.url();
  console.log(`\n${route}`);
  console.log(`  final URL: ${url.slice(0,180)}`);
  console.log(`  password in URL: ${/password=/.test(url) ? "YES — LEAKED" : "no"}`);
  console.log(`  email in URL:    ${/email=/.test(url) ? "yes" : "no"}`);
  await p.close();
}
await b.close();
