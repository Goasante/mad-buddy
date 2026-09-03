import { readFileSync } from "node:fs";
const le=(p)=>{const o={};let t;try{t=readFileSync(p,"utf8")}catch{return o}
for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s||s.startsWith("#"))continue;const i=s.indexOf("=");if(i>0){const v=s.slice(i+1).trim().replace(/^["']|["']$/g,"");if(v&&v!=="PASTE_HERE")o[s.slice(0,i).trim()]=v}}return o};
const load=le("C:/mb-load/.env.load.local"), st=le("C:/mb-load/.env.staging.local");
const APP=process.argv[2];
const a=await fetch(`${st.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:st.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:"staging-user-001@staging.example.com",password:st.MAD_BUDDY_STAGING_USER_PASSWORD})});
const {access_token}=await a.json();
const H={"x-vercel-protection-bypass":load.VERCEL_AUTOMATION_BYPASS_SECRET,Authorization:`Bearer ${access_token}`};
const N=Number(process.argv[3]||20);
const agg={};const totals=[];
for(let i=0;i<N;i++){
  const s=performance.now();
  const r=await fetch(`${APP}/api/profile`,{headers:H});
  const wall=performance.now()-s;
  const st2=r.headers.get("server-timing");
  if(!st2){console.log("no Server-Timing; status",r.status);break}
  if(i===0){console.log("first (cold-ish) wall",wall.toFixed(0)+"ms |",st2);continue}
  totals.push(wall);
  for(const part of st2.split(",")){const m=/(\w+);dur=([\d.]+)/.exec(part.trim());if(m){(agg[m[1]] ||= []).push(Number(m[2]))}}
}
const p=(s,q)=>{const a=[...s].sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(q/100*a.length))]:0};
console.log(`\nwarm samples n=${totals.length}`);
console.log(`WALL (client)   p50 ${p(totals,50).toFixed(0)}ms  p95 ${p(totals,95).toFixed(0)}ms`);
for(const k of ["auth","birth","privacy","plan","identity","journey","j_score","j_tours","total"]){
  if(agg[k]) console.log(`${k.padEnd(15)} p50 ${p(agg[k],50).toFixed(0).padStart(6)}ms  p95 ${p(agg[k],95).toFixed(0).padStart(6)}ms  max ${Math.max(...agg[k]).toFixed(0)}ms`);
}
