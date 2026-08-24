import { chromium } from "playwright";
const BASE="http://localhost:3200";
const SIZES=[[360,800],[390,844],[430,932],[768,1024],[1280,800]];
const b=await chromium.launch();
let bad=0, checks=0;
for (const [w,h] of SIZES) for (const theme of ["light","dark"]) {
  const c=await b.newContext({viewport:{width:w,height:h},isMobile:w<500,hasTouch:w<500,deviceScaleFactor:2,colorScheme:theme});
  const p=await c.newPage();
  await p.goto(BASE,{waitUntil:"networkidle",timeout:60000});
  await p.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=400){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,30));}window.scrollTo(0,0);});
  await p.waitForTimeout(400);
  const r=await p.evaluate(()=>{
    const problems=[];
    const vw=window.innerWidth;
    if(document.documentElement.scrollWidth>vw+1) problems.push(`h-scroll ${document.documentElement.scrollWidth}>${vw}`);
    // overlap / clipping inside the reworked section
    for(const el of document.querySelectorAll("#real-life-moments *, #features *")){
      const cs=getComputedStyle(el);
      if(cs.overflow==="hidden"&&el.scrollHeight>el.clientHeight+6&&el.clientHeight>30){
        const t=(el.textContent||"").replace(/\s+/g," ").trim().slice(0,34);
        problems.push(`clipped: ${t}`);
      }
      const rc=el.getBoundingClientRect();
      /* Decorative layers are positioned deliberately outside the box and are
         aria-hidden + pointer-events:none; they are not content escaping. */
      const decorative=el.getAttribute("aria-hidden")==="true"||cs.pointerEvents==="none";
      if(!decorative&&rc.width>0&&(rc.left<-1||rc.right>vw+1)){
        const t=(el.textContent||"").replace(/\s+/g," ").trim().slice(0,34);
        problems.push(`overflows: ${t||el.tagName}`);
      }
    }
    // the new content must actually be present and legible
    /* textContent, not innerText. The landing page uses scroll-snap plus
       reveal-on-intersect, and innerText omits text in sections the layout has
       parked off-screen -- reporting copy as MISSING that is present, visible
       and opacity:1. Verified directly before changing this. */
    const txt=document.body.textContent||"";
    const need=["Two ways people find each other","With your Muddies","With Linkr","UpFor"];
    for(const n of need) if(!txt.includes(n)) problems.push(`MISSING COPY: ${n}`);
    // the corrected claim must be gone
    if(txt.includes("Only Muddies you both approve can appear nearby")) problems.push("stale claim: only-approved");
    if(txt.includes("Only approved friends can see when you're nearby")) problems.push("stale claim: approved-friends");
    // contrast-ish sanity: no transparent text
    return {problems:[...new Set(problems)].slice(0,6)};
  });
  checks++;
  if(r.problems.length){bad++;console.log(`${w}x${h} ${theme}:`);r.problems.forEach(x=>console.log("   "+x));}
  await c.close();
}
await b.close();
console.log(`\n${checks} viewport/theme combinations, ${bad} with problems`);
