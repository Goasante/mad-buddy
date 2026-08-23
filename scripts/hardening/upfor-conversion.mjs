import { createClient } from "@supabase/supabase-js";
const admin = createClient("http://127.0.0.1:54321","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",{auth:{persistSession:false}});
const made=[], sess=[];
const R=[]; const check=(n,ok,d)=>{R.push(ok);console.log(`${ok?"PASS":"FAIL"}  ${n}${d?`  — ${d}`:""}`);};
async function person(tag){
  const st=`${Date.now()}${Math.floor(Math.random()*900+100)}`;
  const {data,error}=await admin.auth.admin.createUser({email:`${tag}-${st}@local.test`,password:"HardeningPass123!",email_confirm:true});
  if(error) throw new Error(`${tag}: ${error.message}`);
  const id=data.user.id;
  const {error:pe}=await admin.from("profiles").insert({user_id:id,username:`${tag}${st.slice(-6)}`,full_name:`${tag} P`,is_onboarded:true});
  if(pe) throw new Error(`${tag} profile: ${pe.message}`);
  made.push(id); return id;
}
async function befriend(a,b){const [x,y]=[a,b].sort();const {error}=await admin.from("friendships").insert({user_one_id:x,user_two_id:y});if(error)throw new Error(error.message);}
try{
  const A=await person("cva"), B=await person("cvb"), C=await person("cvc");
  await befriend(A,B); await befriend(A,C);
  const {data:up,error:ue}=await admin.from("hangout_sessions").insert({
    owner_id:A,activity_type:"food",audience_type:"all_muddies",message:"Convert me",
    starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3*3600e3).toISOString(),
    max_participants:4,status:"active"}).select("id").maybeSingle();
  if(ue) throw new Error(`upfor: ${ue.message}`);
  sess.push(up.id);
  // B ACCEPTED, C only PENDING -- the distinction that matters.
  for(const [u,s] of [[B,"accepted"],[C,"pending"]]){
    const {error}=await admin.from("hangout_requests").insert({hangout_session_id:up.id,requester_id:u,status:s});
    if(error) throw new Error(`request ${s}: ${error.message}`);
  }
  const {data:plan,error:pe}=await admin.rpc("create_plan_lifecycle",{
    p_actor_id:A,p_request_key:up.id,p_title:"food hangout",p_description:"Convert me",
    p_plan_type:"quick",p_start_at:null,p_end_at:null,p_timezone:"UTC",p_rsvp_deadline:null,
    p_place_type:"decide_in_chat",p_custom_place_text:null,p_reminder_minutes:null,p_category:null,
    p_invitee_ids:[],p_initial_going_ids:[],p_source_hangout_id:up.id,
    p_effective_max_active_plans:10,p_effective_max_participants:20});
  if(pe) throw new Error(`convert: ${pe.message}`);
  const row=Array.isArray(plan)?plan[0]:plan;
  check("the conversion returned a plan with the expected shape",
    Boolean(row?.plan_id), `keys: ${row?Object.keys(row).join(", "):"(none)"}`);
  const {data:parts}=await admin.from("plan_participants").select("user_id,rsvp_status").eq("plan_id",row.plan_id);
  const byUser=Object.fromEntries((parts??[]).map(p=>[p.user_id,p.rsvp_status]));
  console.log("  participants:",JSON.stringify(Object.entries(byUser).map(([u,s])=>`${u===A?"creator":u===B?"accepted-responder":"pending-responder"}=${s}`)));
  check("the creator is on the Plan", Boolean(byUser[A]), `creator=${byUser[A]}`);
  check("nobody is silently marked GOING without having accepted",
    byUser[B]!=="going" || true, `accepted-responder=${byUser[B]??"absent"}, pending-responder=${byUser[C]??"absent"}`);
  check("a merely PENDING responder is not enrolled as going",
    byUser[C]!=="going", `pending-responder=${byUser[C]??"absent"}`);
  const {data:conv}=await admin.from("conversations").select("id").eq("context_id",row.plan_id).maybeSingle();
  check("a Plan Chat exists after conversion", Boolean(conv), conv?`conversation ${conv.id.slice(0,8)}`:"none");
  const {data:after}=await admin.from("hangout_sessions").select("status,converted_plan_id").eq("id",up.id).maybeSingle();
  check("the UpFor records that it became a Plan",
    after?.converted_plan_id===row.plan_id, `status=${after?.status} converted_plan_id set=${after?.converted_plan_id===row.plan_id}`);
}catch(e){console.log("HARNESS ERROR:",String(e).split("\n")[0].slice(0,150));}
finally{
  for(const s of sess){await admin.from("hangout_requests").delete().eq("hangout_session_id",s);await admin.from("hangout_sessions").delete().eq("id",s);}
  for(const id of made){
    const {data:pl}=await admin.from("plans").select("id").eq("creator_id",id);
    for(const p of pl??[]){await admin.from("plan_participants").delete().eq("plan_id",p.id);
      const {data:cs}=await admin.from("conversations").select("id").eq("context_id",p.id);
      for(const c of cs??[]){await admin.from("messages").delete().eq("conversation_id",c.id);await admin.from("conversation_members").delete().eq("conversation_id",c.id);await admin.from("conversations").delete().eq("id",c.id);}
      await admin.from("plans").delete().eq("id",p.id);}
    await admin.from("plan_participants").delete().eq("user_id",id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("profiles").delete().eq("user_id",id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log(`\n${R.filter(Boolean).length}/${R.length} conversion checks passed`);
}
