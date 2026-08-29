import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(process.argv[2]);
const r = await p.evaluate(() => {
  const layer = document.querySelector(".layer").getBoundingClientRect();
  const av = document.querySelector(".av").getBoundingClientRect();
  return {
    dx: Math.round((layer.left + layer.width / 2) - (av.left + av.width / 2)),
    dy: Math.round((layer.top + layer.height / 2) - (av.top + av.height / 2))
  };
});
console.log("layer-vs-avatar offset:", JSON.stringify(r));
await b.close();
