import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../../mobile/node_modules/vite/dist/node/index.js';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = await fs.mkdtemp(path.join(root, '.meetup-review-'));
const prefix = '/' + path.basename(dir);
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now = Date.now(), iso = d => new Date(now+d).toISOString();
const member = (n,response='accepted') => ({key:uuid(n),userId:uuid(n),name:n===1?'You':'Ama',response,arrival:'not_started',delayMinutes:null,metAt:null,suggestedStartAt:null,journeyState:'waiting',observedAt:null,homeStartedAt:null,homeArrivedAt:null});
const meetup = (n,title,offset) => ({id:uuid(n),creatorId:uuid(1),hostId:null,mode:'meet_somewhere',placeLabel:'Decide in chat',title,note:'',startsAt:iso(offset),expiresAt:iso(offset+21600000),timezone:'Africa/Accra',status:'active',revision:1,category:'coffee',beaconStatus:'unset',togetherAt:null,members:[member(1),member(2),member(3,'invited')],activity:[],conversationId:uuid(30)});
const listing = (n,title,status) => ({id:uuid(n),creatorId:uuid(1),creatorName:'You',creatorUsername:'you',creatorAvatarUrl:null,title,category:'coffee',style:'group',startsAt:iso(86400000),timezone:'Africa/Accra',listingExpiresAt:iso(status==='active'?86400000:-60000),listingDurationMinutes:0,status,maxAttendees:6,interestLimit:6,interestCount:1,refreshCount:0,renewable:true,attendeeCount:0,myInterestStatus:null,meetupId:null,conversationId:null,interestedPeople:[{userId:uuid(2),name:'Ama',username:'ama',avatarUrl:null,status:'pending'}]});
const fixtures = {
  meetups:[meetup(10,'Coffee proof',3600000),meetup(11,'Walk proof',-300000),meetup(12,'Weekend proof',86400000),{...meetup(13,'Ended proof',-86400000),status:'ended',endedAt:iso(-300000),endReason:'expired'}],
  hub:{nearby:[],mine:[listing(20,'Open coffee','active'),listing(21,'Expired coffee','expired')],requests:[{...listing(22,'Requested coffee','expired'),creatorId:uuid(2),myInterestStatus:'pending',interestedPeople:[]}],activeSlots:1,maxActiveSlots:3}
};
fixtures.hub.requests=[{...listing(22,'Requested coffee','expired'),creatorId:uuid(2),myInterestStatus:'pending',interestedPeople:[]}];
await fs.writeFile(path.join(dir,'platform.tsx'), `import React from 'react';
export const PLATFORM_KIND = new URLSearchParams(location.search).get('platform') === 'mobile' ? 'mobile' : 'web';
export const Link=({href,children,...props})=><a href={href} {...props}>{children}</a>;
export const syncCurrentLocation=async()=>({ok:true});
export const subscribeMeetupRealtime=()=>()=>{};
export const useRevalidate=()=>()=>{};
`);
await fs.writeFile(path.join(dir,'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body><div id="root"></div><script type="module" src="'+prefix+'/app.jsx"></script></body></html>');
await fs.writeFile(path.join(dir,'app.jsx'), `import React,{useCallback,useState} from 'react';import{createRoot}from'react-dom/client';
import {MeetupPage} from '@/components/meetups/meetup-page';import '@/app/globals.css';
const initial=${JSON.stringify(fixtures)};window.proofCommands=[];
function App(){const[meetups,setMeetups]=useState(initial.meetups);const[hub,setHub]=useState(initial.hub);const refresh=useCallback(async()=>{},[]);
const save=async(input,create)=>{window.proofCommands.push({input,create});if(input.action==='place')setMeetups(ms=>ms.map(m=>m.id===input.id?{...m,placeLabel:input.placeLabel,revision:m.revision+1}:m));if(input.action==='beacon')setMeetups(ms=>ms.map(m=>m.id===input.id?{...m,beaconStatus:'provisional',members:m.members.map(p=>p.userId===initial.meetups[0].creatorId?{...p,arrival:'here'}:p)}:m));return{ok:true,message:'Saved'};};
const discovery=async(input,create)=>{window.proofCommands.push({input,create});if(input.action==='decide')setHub(h=>({...h,mine:h.mine.map(d=>d.id===input.id?{...d,interestedPeople:d.interestedPeople.filter(p=>p.userId!==input.userId)}:d)}));if(input.action==='refresh')setHub(h=>({...h,activeSlots:h.activeSlots+1,mine:h.mine.map(d=>d.id===input.id?{...d,status:'active',listingExpiresAt:d.startsAt,refreshCount:d.refreshCount+1}:d)}));if(input.action==='delete')setHub(h=>({...h,mine:h.mine.filter(d=>d.id!==input.id)}));return{ok:true,message:'Saved'};};
return <MeetupPage viewerId="${uuid(1)}" meetups={meetups} muddies={[{id:'${uuid(2)}',name:'Ama'}]} discoveryHub={hub} saveAction={save} discoveryAction={discovery} reloadAction={refresh} initialNowMs={${now}}/>;}
// Reproduce the shell's reserved space for the fixed phone header.
createRoot(document.getElementById('root')).render(<div className={new URLSearchParams(location.search).get('platform')==='mobile'?'':'pt-[var(--mobile-header-height)] md:pt-0'}><App/></div>);`);
const server = await createServer({configFile:false,root,publicDir:path.join(root,'public'),resolve:{alias:[{find:/^@\/lib\/platform$/,replacement:path.join(dir,'platform.tsx')},{find:'@',replacement:root}]},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:5186,strictPort:true},logLevel:'error'});
let browser;
try {
  await server.listen(); browser=await chromium.launch({headless:true,executablePath:process.env.MEETUP_CHROMIUM_PATH,args:['--no-sandbox']});
  for(const [width,platform] of [[390,'web'],[390,'mobile'],[1280,'web']]) {
    const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});page.setDefaultTimeout(10000);
    await page.goto('http://127.0.0.1:5186'+prefix+'/index.html?platform='+platform);
    await page.getByRole('heading',{name:'Coming up',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/My Meetups/}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByRole('heading',{name:'Recently ended'}).count(),1);
    await page.getByRole('button',{name:/Coffee proof/}).click();
    await page.getByRole('button',{name:'Agree on a place',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').fill('Accra café');await dialog.getByRole('button',{name:'Save agreed place'}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText('Accra café',{exact:true}).first().waitFor();assert.match(await page.getByRole('button',{name:/Coffee proof/}).innerText(),/Accra café/);
    await page.getByRole('button',{name:'I’m here',exact:true}).click();
    await page.waitForFunction(()=>window.proofCommands.some(x=>x.input.action==='beacon'));
    assert.equal(await page.getByText('Coming up · arrival updates open',{exact:true}).count(),1);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.getByRole('button',{name:'Meet New People',exact:true}).click();
    await page.getByRole('button',{name:/continue/i}).click();
    await page.getByRole('heading',{name:'Interest inbox',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Closed listings',exact:true}).count(),1);
    assert.equal(await page.getByRole('heading',{name:'My interest requests',exact:true}).count(),1);
    const expired=page.locator('article').filter({has:page.getByText('Expired coffee',{exact:true})}).first();
    // An expired listing's pending interest remains actionable in the inbox.
    await expired.getByRole('button',{name:'Accept',exact:true}).click();
    await page.waitForFunction(()=>window.proofCommands.some(x=>x.input.action==='decide'&&x.input.id.endsWith('000021')));
    await page.getByRole('button',{name:'Renew',exact:true}).click();
    await page.waitForFunction(()=>window.proofCommands.some(x=>x.input.action==='refresh'));
    await page.getByRole('button',{name:'Start a listing',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Until meetup starts',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('dialog').getByRole('textbox').first().fill('New coffee');
    await page.getByRole('button',{name:'Publish nearby',exact:true}).click();
    await page.waitForFunction(()=>window.proofCommands.some(x=>x.create===true&&x.input.durationMinutes===0));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'/tmp/meetup-product-'+width+'-'+platform+'.png',fullPage:true});
    console.log('PASS',width,platform,'navigation, place, arrival, expired inbox, renewal, until-start publishing, overflow and runtime errors');
    await page.close();
  }
}finally{await browser?.close();await server.close();await fs.rm(dir,{recursive:true,force:true});}
