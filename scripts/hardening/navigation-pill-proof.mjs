import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../../mobile/node_modules/vite/dist/node/index.js';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = await fs.mkdtemp(path.join(root, '.nav-review-'));
const prefix = '/' + path.basename(dir);
await fs.writeFile(path.join(dir, 'platform.jsx'), `import React,{useSyncExternalStore} from 'react';
const subscribe=fn=>{window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn)};
export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.hash.slice(1)||'/dashboard');
export function Link({href,children,prefetch,featureLockIndicator,onClick,...props}){return <a href={'#'+href} {...props} onClick={onClick}>{children}</a>}
`);
await fs.writeFile(path.join(dir, 'index.html'), `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module" src="${prefix}/app.jsx"></script></body></html>`);
await fs.writeFile(path.join(dir, 'app.jsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{MobileNav}from'@/components/app-shell/mobile-nav';
import{FeatureAvailabilityContext}from'@/components/features/feature-availability-context';
import'@/app/globals.css';import'@/app/mobile-shell-stability.css';import'@/app/mobile-nav-polish.css';
window.homeReselects=0;function App(){const[immersive,setImmersive]=useState(false);window.setImmersive=setImmersive;
const native=new URLSearchParams(location.search).has('native');
return <FeatureAvailabilityContext.Provider value={{linkr:true,meet_up:true}}><main style={{minHeight:'100dvh',background:'#faf8f4'}}><h1>Navigation verification</h1></main><MobileNav immersive={immersive} messageUnreadCount={12} muddyRequestCount={3} onHomeReselect={()=>window.homeReselects++} isDestinationAvailable={native?href=>href!=='/linkr':undefined}/></FeatureAvailabilityContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`);
const server = await createServer({configFile:false,root,resolve:{alias:[{find:/^@\/lib\/platform$/,replacement:path.join(dir,'platform.jsx')},{find:'@',replacement:root}]},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:5187,strictPort:true},logLevel:'error'});
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.NAV_CHROMIUM_PATH,args:['--no-sandbox']});
  for(const width of [320,360,390,430])for(const dark of [false,true])for(const textSize of [16,32]) {
    const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:5187${prefix}/index.html`);
    await page.getByRole('navigation').waitFor();
    await page.evaluate(({dark,textSize})=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.fontSize=textSize+'px'}, {dark,textSize});
    const nav=page.getByRole('navigation');
    assert.deepEqual(await nav.locator('.mobile-nav-label').allTextContents(),['Messages','Muddies','Home','Linkr','Meetups']);
    for(const [label,href] of [['Messages','/messages'],['Muddies','/friends'],['Home','/dashboard'],['Linkr','/linkr'],['Meetups','/meet-up']]) {
      const link=nav.getByRole('link',{name:label,exact:true});await link.click();
      await page.waitForFunction(href=>location.hash==='#'+href,href);
      assert.equal(await link.getAttribute('aria-current'),'page');
      await page.waitForFunction(href=>getComputedStyle(document.querySelector(`nav a[href="#${href}"]`)).color==='rgb(243, 139, 32)',href);
      const boxes=await nav.locator('ul > li').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
      assert.ok(Math.max(...boxes)-Math.min(...boxes)<1,'tabs must remain equal width');
      const layout=await link.evaluate(el=>{const icon=el.querySelector('svg').getBoundingClientRect(),label=el.querySelector('.mobile-nav-label').getBoundingClientRect(),dock=el.closest('ul').getBoundingClientRect();return {iconBottom:icon.bottom,labelTop:label.top,labelBottom:label.bottom,dockBottom:dock.bottom}});
      assert.ok(layout.iconBottom<=layout.labelTop+1,'icon must sit above label');
      assert.ok(layout.labelBottom<=layout.dockBottom+1,'large labels must not exceed dock');
    }
    assert.equal(await nav.getByText('12',{exact:true}).count(),1);
    assert.equal(await nav.getByText('3',{exact:true}).count(),1);
    await nav.getByRole('link',{name:'Home',exact:true}).click();await nav.getByRole('link',{name:'Home',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.homeReselects),1);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('nav a[aria-current="page"]')).color==='rgb(243, 139, 32)');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width===390&&textSize===16)await page.screenshot({path:`/tmp/navigation-pill-${dark?'dark':'light'}.png`});
    await page.evaluate(()=>window.setImmersive(true));await nav.waitFor({state:'hidden'});
    assert.equal(await page.locator('nav').getAttribute('aria-hidden'),'true');
    assert.deepEqual(errors,[]);await page.close();
    console.log('PASS',width,dark?'dark':'light',textSize,'equal tabs, route state, labels, badges, Home reselect, immersive hiding, overflow');
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(`http://127.0.0.1:5187${prefix}/index.html?native=1`);
  // aria-disabled explains the missing destination; a physical tap still
  // opens its notice. Playwright's enabled check intentionally skips this.
  await page.getByRole('button',{name:'Linkr. Coming soon on Android.',exact:true}).click({force:true});
  await page.getByRole('status').waitFor();assert.equal(await page.evaluate(()=>location.hash),'');
  console.log('PASS native unavailable destination remains non-navigating and announced');
  await page.close();
  // Real scrolling content must remain visible through the dock, rather than
  // a static grey surface passing only geometry checks.
  for (const dark of [false,true]) {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    await page.goto(`http://127.0.0.1:5187${prefix}/index.html`);
    const dock=page.getByRole('navigation').locator('ul');await dock.waitFor();
    await page.evaluate(dark=>{
      document.documentElement.classList.toggle('dark',dark);
      const main=document.querySelector('main');
      main.style.minHeight='2200px';
      main.style.background=dark
        ? 'repeating-linear-gradient(0deg,#241c3e 0px,#241c3e 140px,#1d3540 140px,#1d3540 280px,#453020 280px,#453020 420px)'
        : 'repeating-linear-gradient(0deg,#e7def6 0px,#e7def6 140px,#d7edf2 140px,#d7edf2 280px,#f6e5cc 280px,#f6e5cc 420px)';
    },dark);
    const glass=await dock.evaluate(el=>{const s=getComputedStyle(el);return {blur:s.backdropFilter,border:s.borderTopColor}});
    assert.equal(glass.blur,'blur(8px) saturate(1.25)');
    assert.equal(glass.border,dark?'rgba(255, 255, 255, 0.06)':'rgba(80, 75, 68, 0.08)');
    const before=await dock.screenshot();
    await page.evaluate(()=>window.scrollTo(0,170));
    await page.waitForFunction(()=>window.scrollY===170);
    const after=await dock.screenshot();
    assert.ok(!before.equals(after),'scrolling content must change the glass surface');
    await page.screenshot({path:`/tmp/navigation-glass-scroll-${dark?'dark':'light'}.png`});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
    await page.waitForFunction(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches);
    const fallback=await dock.evaluate(el=>{const s=getComputedStyle(el);return {blur:s.backdropFilter,background:s.backgroundColor}});
    assert.equal(fallback.blur,'none');
    assert.equal(fallback.background,dark?'rgb(24, 24, 27)':'rgb(255, 255, 255)');
    console.log('PASS',dark?'dark':'light','scroll-through glass, subtle edge, reduced-transparency fallback');
    await page.close();
  }
} finally {await browser?.close();await server.close();await fs.rm(dir,{recursive:true,force:true});}
