import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const browser = await chromium.launch({headless:true,channel:'msedge'});
const results=[];
await fs.mkdir('screenshots/upfor-polish',{recursive:true});
for (const [width,height] of [[390,844],[360,800],[375,667],[430,932],[320,640]]) {
 for (const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(t=>localStorage.setItem('mad-buddy-theme',t),theme);
  await page.goto('http://localhost:3107/dev/upfor-cards',{waitUntil:'networkidle',timeout:120000});
  await page.evaluate(t=>{document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.dataset.theme=t;},theme);
  await page.locator('.upfor-card').first().waitFor();
  await page.screenshot({path:`screenshots/upfor-polish/${width}-${theme}.png`,fullPage:true});
  const metrics=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
   return {overflow:document.documentElement.scrollWidth>innerWidth, cards:[...document.querySelectorAll('.upfor-card')].map(c=>({id:c.dataset.upforId,card:rect(c),content:rect(c.querySelector('.upfor-card__content')),rail:rect(c.querySelector('.upfor-card__rail')),actions:[...c.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),...rect(b)}))})),hero:rect(document.querySelector('[class*="heroCopy"]').parentElement),quick:rect(document.querySelector('.quick-actions-trigger'))};
  });
  await page.locator('#hangout-ended').scrollIntoViewIfNeeded();
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  const final=await page.evaluate(()=>({cardBottom:document.querySelector('#hangout-ended').getBoundingClientRect().bottom,navTop:document.querySelector('nav[aria-label="Mobile navigation"] > ul').getBoundingClientRect().top}));
  await page.screenshot({path:`screenshots/upfor-polish/${width}-${theme}-last.png`});
  results.push({width,height,theme,errors,...metrics,final});
  if(width===390 && theme==='dark') {
   await page.locator('#hangout-fresh-food button').filter({hasText:"I'm in"}).click();
   await page.locator('#hangout-fresh-food .upfor-card__status').filter({hasText:'Pending'}).waitFor();
   await page.locator('#hangout-fresh-food button[aria-label="More options for this request"]').click();
   await page.getByRole('menuitem',{name:'Cancel request'}).click();
   await page.locator('#hangout-fresh-food button').filter({hasText:"I'm in"}).waitFor();
   await page.getByRole('button',{name:'Open quick actions',exact:true}).click();
   await page.screenshot({path:'screenshots/upfor-polish/quick-actions-open.png'});
  }
  await page.close();
 }
}
await fs.writeFile('screenshots/upfor-polish/metrics.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({width:r.width,theme:r.theme,overflow:r.overflow,errors:r.errors,hero:r.hero.h,heights:r.cards.map(c=>[c.id,c.card.h]),collisions:r.cards.filter(c=>c.content.right>c.rail.x+1).map(c=>c.id),smallTargets:r.cards.flatMap(c=>c.actions.filter(a=>a.w<43.9||a.h<43.9)),final:r.final})),null,2));
await browser.close();


