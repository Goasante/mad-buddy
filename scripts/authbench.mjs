import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const le=(p)=>{const o={};let t;try{t=readFileSync(p,"utf8")}catch{return o}
for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0){const v=s.slice(i+1).trim().replace(/^["']|["']$/g,"");if(v&&v!=="PASTE_HERE")o[s.slice(0,i).trim()]=v}}return o};
const st=le("C:/mb-load/.env.staging.local");
const U=st.NEXT_PUBLIC_SUPABASE_URL,K=st.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const a=await fetch(`${U}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:K,"Content-Type":"application/json"},body:JSON.stringify({email:"staging-user-001@staging.example.com",password:st.MAD_BUDDY_STAGING_USER_PASSWORD})});
const {access_token}=await a.json();
const p=(s,q)=>s.length?s[Math.min(s.length-1,Math.floor(q/100*s.length))]:0;

// getUser: documented to hit the Auth server every time
const c=createClient(U,K,{auth:{persistSession:false,autoRefreshToken:false}});
let t=[];for(let i=0;i<50;i++){const s=performance.now();await c.auth.getUser(access_token);t.push(performance.now()-s)}
t.sort((x,y)=>x-y);
console.log(`getUser()   n=50 p50 ${p(t,50).toFixed(0)}ms p95 ${p(t,95).toFixed(0)}ms p99 ${p(t,99).toFixed(0)}ms`);

// getClaims: should verify locally via cached JWKS for ES256
let t2=[];let err=null;
for(let i=0;i<50;i++){const s=performance.now();
  try{await c.auth.getClaims(access_token)}catch(e){err=e.message}
  t2.push(performance.now()-s)}
t2.sort((x,y)=>x-y);
console.log(`getClaims() n=50 p50 ${p(t2,50).toFixed(0)}ms p95 ${p(t2,95).toFixed(0)}ms p99 ${p(t2,99).toFixed(0)}ms${err?" ERR:"+err:""}`);

// concurrency on getUser
for(const c1 of [1,5,10,25,50]){
  const times=[];let fails=0;
  await Promise.all(Array.from({length:c1},async()=>{const s=performance.now();
    const r=await c.auth.getUser(access_token).catch(()=>{fails++;return null});
    times.push(performance.now()-s);void r}));
  times.sort((x,y)=>x-y);
  console.log(`  getUser conc=${String(c1).padStart(3)} p50 ${p(times,50).toFixed(0).padStart(5)}ms p95 ${p(times,95).toFixed(0).padStart(5)}ms fails ${fails}`);
}
